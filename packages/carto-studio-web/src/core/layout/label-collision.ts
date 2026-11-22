import type {
  ComposableStylePack,
  GateIssue,
  GateResult,
  HistoricalToponym,
  MapSnapshot,
} from "@historical-cartography/shared-schema";
import type { Feature, LineString, Polygon, Position } from "geojson";
import type { PolityMetadata } from "../data/demo-types.ts";
import { extractPolityOuterPerimeterRings, ringSignedArea } from "../data/topology-builder.ts";

export interface ScreenBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PlacedToponymLabel {
  toponym_id: string;
  text_primary: string;
  text_secondary?: string;
  display_text: string;
  coordinates: [number, number];
  screen_x: number;
  screen_y: number;
  priority: number;
  entity_rank: HistoricalToponym["entity_rank"];
  location_precision: HistoricalToponym["location_precision"];
  bbox: ScreenBox;
  visible: boolean;
  collided_with_id?: string;
}

export interface LabelLayoutReport {
  viewport: { width: number; height: number; zoom: number };
  high_priority_threshold: number;
  placed: PlacedToponymLabel[];
  hidden_ids: string[];
  high_priority_collision_count: number;
  g5_label_gate: GateResult;
}

export function pointInRing(pt: Position, ring: readonly Position[]): boolean {
  const x = pt[0] ?? 0;
  const y = pt[1] ?? 0;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i]?.[0] ?? 0;
    const yi = ring[i]?.[1] ?? 0;
    const xj = ring[j]?.[0] ?? 0;
    const yj = ring[j]?.[1] ?? 0;
    const intersect = (yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi + 1e-18) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

export function pointInPolygon(pt: Position, polygonRings: readonly (readonly Position[])[]): boolean {
  const outer = polygonRings[0];
  if (!outer || !pointInRing(pt, outer)) return false;
  for (let h = 1; h < polygonRings.length; h++) {
    if (pointInRing(pt, polygonRings[h]!)) return false;
  }
  return true;
}

function pointToRingSignedDist(x: number, y: number, ring: readonly Position[]): number {
  let minDistSq = Infinity;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const ax = ring[j]?.[0] ?? 0;
    const ay = ring[j]?.[1] ?? 0;
    const bx = ring[i]?.[0] ?? 0;
    const by = ring[i]?.[1] ?? 0;
    const dx = bx - ax;
    const dy = by - ay;
    const lenSq = dx * dx + dy * dy;
    let t = 0;
    if (lenSq > 1e-15) {
      t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / lenSq));
    }
    const px = ax + dx * t;
    const py = ay + dy * t;
    const dSq = (x - px) ** 2 + (y - py) ** 2;
    if (dSq < minDistSq) minDistSq = dSq;
  }
  const dist = Math.sqrt(minDistSq);
  return pointInRing([x, y], ring) ? dist : -dist;
}

/**
 * Quadtree Polylabel: finds the visual interior center (maximum inscribed circle)
 * while automatically excluding any interior enclave holes (`holeRings`).
 */
export function computePolylabel(
  ring: readonly Position[],
  precisionOrHoles?: number | readonly (readonly Position[])[],
  precisionOpt?: number,
): { center: [number, number]; radius: number } {
  const holeRings: readonly (readonly Position[])[] = Array.isArray(precisionOrHoles) ? precisionOrHoles : [];
  const precisionArg = typeof precisionOrHoles === "number" ? precisionOrHoles : precisionOpt;
  if (ring.length < 3) return { center: [0, 0], radius: 0 };
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of ring) {
    const x = p[0] ?? 0;
    const y = p[1] ?? 0;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const width = maxX - minX;
  const height = maxY - minY;
  const cellSize = Math.min(width, height);
  if (cellSize <= 1e-9) return { center: [(minX + maxX) / 2, (minY + maxY) / 2], radius: 0 };

  const prec = precisionArg ?? Math.max(0.01, cellSize * 0.02);
  const h0 = cellSize / 2;
  interface Cell {
    x: number;
    y: number;
    h: number;
    d: number;
    max: number;
  }
  const signedDistWithHoles = (x: number, y: number): number => {
    let d = pointToRingSignedDist(x, y, ring);
    for (const hole of holeRings) {
      const hd = pointToRingSignedDist(x, y, hole);
      d = Math.min(d, -hd);
    }
    return d;
  };
  const makeCell = (x: number, y: number, h: number): Cell => {
    const d = signedDistWithHoles(x, y);
    return { x, y, h, d, max: d + h * Math.SQRT2 };
  };

  const queue: Cell[] = [];
  for (let x = minX; x < maxX; x += cellSize) {
    for (let y = minY; y < maxY; y += cellSize) {
      queue.push(makeCell(x + h0, y + h0, h0));
    }
  }
  let best = makeCell((minX + maxX) / 2, (minY + maxY) / 2, 0);
  for (const c of queue) {
    if (c.d > best.d) best = c;
  }

  let steps = 0;
  while (queue.length > 0 && steps < 400) {
    steps += 1;
    queue.sort((a, b) => b.max - a.max);
    const cell = queue.shift()!;
    if (cell.d > best.d) best = cell;
    if (cell.max - best.d <= prec) continue;
    const h = cell.h / 2;
    for (const [ox, oy] of [[-h, -h], [h, -h], [-h, h], [h, h]] as const) {
      const child = makeCell(cell.x + ox, cell.y + oy, h);
      if (child.d > best.d) best = child;
      if (child.max - best.d > prec) queue.push(child);
    }
  }
  return { center: [best.x, best.y], radius: Math.max(0, best.d) };
}

export function formatToponymLabelParts(
  toponym: HistoricalToponym,
  typography: ComposableStylePack["typography"],
): { primary: string; secondary?: string; combined: string } {
  const questionSuffix =
    typography.show_uncertainty_question_mark && toponym.location_precision === "UNCERTAIN"
      ? " ?"
      : "";
  const primary = `${toponym.name_zh}${questionSuffix}`;
  const orig = toponym.name_original_script?.trim();
  if (!orig || typography.bilingual_mode === "NONE") {
    return { primary, combined: primary };
  }
  if (typography.bilingual_mode === "INLINE") {
    return { primary, secondary: orig, combined: `${primary} (${orig})` };
  }
  return { primary, secondary: orig, combined: `${primary}\n${orig}` };
}

export function estimateTextWidthPx(text: string, fontSizePx: number): number {
  let w = 0;
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 32;
    w += code >= 0x2e80 ? fontSizePx * 1.05 : fontSizePx * 0.58;
  }
  return w;
}

export function boxesIntersect(a: ScreenBox, b: ScreenBox, paddingPx = 4): boolean {
  return !(
    a.x + a.width + paddingPx <= b.x
    || b.x + b.width + paddingPx <= a.x
    || a.y + a.height + paddingPx <= b.y
    || b.y + b.height + paddingPx <= a.y
  );
}

export function projectLonLatToScreen(
  lonLat: [number, number],
  center: [number, number],
  zoom: number,
  viewportWidth: number,
  viewportHeight: number,
): [number, number] {
  const worldSize = 512 * 2 ** zoom;
  const mercX = (lon: number): number => ((lon + 180) / 360) * worldSize;
  const mercY = (lat: number): number => {
    const clamped = Math.max(-85, Math.min(85, lat));
    const sin = Math.sin((clamped * Math.PI) / 180);
    return (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * worldSize;
  };
  const px = mercX(lonLat[0]) - mercX(center[0]) + viewportWidth / 2;
  const py = mercY(lonLat[1]) - mercY(center[1]) + viewportHeight / 2;
  return [px, py];
}

export function evaluateToponymLayout(params: {
  toponyms: readonly HistoricalToponym[];
  typography: ComposableStylePack["typography"];
  center: [number, number];
  zoom: number;
  viewport: { width: number; height: number };
  high_priority_threshold?: number;
  current_jdn?: number;
  obstacle_boxes?: ReadonlyArray<{ id: string; box: ScreenBox }>;
  projectPoint?: (lonLat: [number, number]) => [number, number];
}): LabelLayoutReport {
  const threshold = params.high_priority_threshold ?? 80;
  const activeToponyms = params.current_jdn !== undefined
    ? params.toponyms.filter(
        (t) => params.current_jdn! >= t.valid_from_jdn && params.current_jdn! < t.valid_to_jdn,
      )
    : params.toponyms;

  const sorted = [...activeToponyms].sort((a, b) => {
    if (b.label_priority !== a.label_priority) return b.label_priority - a.label_priority;
    return a.toponym_id.localeCompare(b.toponym_id);
  });

  const acceptedBoxes: Array<{ id: string; box: ScreenBox }> = [
    ...(params.obstacle_boxes ?? []),
  ];
  const placed: PlacedToponymLabel[] = [];
  const hiddenIds: string[] = [];
  const issues: GateIssue[] = [];

  for (const top of sorted) {
    const [sx, sy] = params.projectPoint
      ? params.projectPoint(top.coordinates)
      : projectLonLatToScreen(
          top.coordinates,
          params.center,
          params.zoom,
          params.viewport.width,
          params.viewport.height,
        );

    const parts = formatToponymLabelParts(top, params.typography);
    const fontSize = top.entity_rank === "CAPITAL" ? 12 : 11;
    const primW = estimateTextWidthPx(parts.primary, fontSize);
    const secW = parts.secondary ? estimateTextWidthPx(parts.secondary, fontSize - 1) : 0;
    const contentW = parts.secondary
      ? params.typography.bilingual_mode === "INLINE"
        ? primW + secW + 14
        : Math.max(primW, secW)
      : primW;
    const width = Math.max(46, Math.ceil(contentW + 14));
    const symbolReserveH = 13;
    const textH = parts.secondary && params.typography.bilingual_mode === "STACKED" ? 30 : 17;
    const height = symbolReserveH + textH;
    const box: ScreenBox = {
      x: sx - width / 2,
      y: sy - height / 2,
      width,
      height,
    };

    const inViewport =
      box.x + box.width > 0
      && box.x < params.viewport.width
      && box.y + box.height > 0
      && box.y < params.viewport.height;

    let colliderId: string | undefined;
    if (inViewport) {
      for (const existing of acceptedBoxes) {
        if (boxesIntersect(box, existing.box, 3)) {
          colliderId = existing.id;
          break;
        }
      }
    }

    const visible = inViewport && !colliderId;
    if (visible) {
      acceptedBoxes.push({ id: top.toponym_id, box });
    } else if (colliderId) {
      hiddenIds.push(top.toponym_id);
      if (top.label_priority >= threshold) {
        issues.push({
          gate: "G5",
          code: "LABEL_COLLISION",
          entity_id: top.toponym_id,
          message: `高优先级地名「${top.name_zh}」(priority=${top.label_priority}) 在缩放 ${params.zoom.toFixed(2)} 下与「${colliderId}」发生屏幕碰撞。`,
        });
      }
    }

    placed.push({
      toponym_id: top.toponym_id,
      text_primary: parts.primary,
      ...(parts.secondary !== undefined ? { text_secondary: parts.secondary } : {}),
      display_text: parts.combined,
      coordinates: top.coordinates,
      screen_x: Number(sx.toFixed(1)),
      screen_y: Number(sy.toFixed(1)),
      priority: top.label_priority,
      entity_rank: top.entity_rank,
      location_precision: top.location_precision,
      bbox: box,
      visible,
      ...(colliderId !== undefined ? { collided_with_id: colliderId } : {}),
    });
  }

  return {
    viewport: { width: params.viewport.width, height: params.viewport.height, zoom: params.zoom },
    high_priority_threshold: threshold,
    placed,
    hidden_ids: hiddenIds,
    high_priority_collision_count: issues.length,
    g5_label_gate: { gate: "G5", passed: issues.length === 0, issues },
  };
}

function horizontalRayIntersections(y: number, ring: readonly Position[]): number[] {
  const xs: number[] = [];
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i]?.[0] ?? 0;
    const yi = ring[i]?.[1] ?? 0;
    const xj = ring[j]?.[0] ?? 0;
    const yj = ring[j]?.[1] ?? 0;
    if ((yi > y) !== (yj > y)) {
      xs.push(xi + ((y - yi) * (xj - xi)) / (yj - yi));
    }
  }
  xs.sort((a, b) => a - b);
  return xs;
}

/**
 * Compute interior curved medial-axis spine lines using true Polylabel on the largest
 * contiguous merged polygon ring of each polity (never merging exclaves with homeland).
 */
export function buildPolitySpineLabels(
  snapshot: MapSnapshot,
  polities: readonly PolityMetadata[],
  typography: ComposableStylePack["typography"],
): Array<
  Feature<
    LineString,
    {
      polity_id: string;
      label_text: string;
      label_primary: string;
      label_secondary?: string;
      center: [number, number];
      letter_spacing_em: number;
      rank_weight: number;
    }
  >
> {
  const polityMap = new Map<string, PolityMetadata>();
  for (const p of polities) polityMap.set(p.polity_id, p);

  const mergedPolities = extractPolityOuterPerimeterRings(snapshot);
  const features: Array<
    Feature<
      LineString,
      {
        polity_id: string;
        label_text: string;
        label_primary: string;
        label_secondary?: string;
        center: [number, number];
        letter_spacing_em: number;
        rank_weight: number;
      }
    >
  > = [];

  const holesByPolity = new Map<string, Position[][]>();
  for (const feat of snapshot.territories.features) {
    const pid = feat.properties.polity_id;
    if (!pid || feat.geometry.coordinates.length <= 1) continue;
    const holes = feat.geometry.coordinates.slice(1);
    const cur = holesByPolity.get(pid) ?? [];
    cur.push(...holes);
    holesByPolity.set(pid, cur);
  }

  for (const entry of mergedPolities) {
    if (entry.polity_id.startsWith("disputed:")) continue;
    const holes = holesByPolity.get(entry.polity_id) ?? [];
    // Choose the largest outer ring (with holes excluded) so titles center cleanly in homeland
    const sortedRings = [...entry.rings].sort(
      (a, b) => Math.abs(ringSignedArea(b)) - Math.abs(ringSignedArea(a)),
    );
    let bestRing = sortedRings[0];
    let bestLabel = bestRing ? computePolylabel(bestRing, holes) : { center: [0, 0] as [number, number], radius: 0 };
    for (let i = 1; i < sortedRings.length; i++) {
      const candidateRing = sortedRings[i]!;
      const cand = computePolylabel(candidateRing, holes);
      if (cand.radius > bestLabel.radius) {
        bestLabel = cand;
        bestRing = candidateRing;
      }
    }
    if (!bestRing || bestRing.length < 3) continue;

    const [cx, cy] = bestLabel.center;
    const xs = horizontalRayIntersections(cy, bestRing);
    let leftBound = cx - Math.max(0.8, bestLabel.radius * 1.4);
    let rightBound = cx + Math.max(0.8, bestLabel.radius * 1.4);
    for (let i = 0; i + 1 < xs.length; i += 2) {
      if (xs[i]! <= cx && cx <= xs[i + 1]!) {
        const span = xs[i + 1]! - xs[i]!;
        leftBound = cx - span * 0.34;
        rightBound = cx + span * 0.34;
        break;
      }
    }
    const archDy = typography.curved_along_spine ? Math.min(1.6, bestLabel.radius * 0.24) : 0;
    const midY = pointInRing([cx, cy + archDy], bestRing) ? cy + archDy : cy;
    const pStart: Position = [Number(leftBound.toFixed(4)), Number((cy - archDy * 0.35).toFixed(4))];
    const pMid: Position = [Number(cx.toFixed(4)), Number(midY.toFixed(4))];
    const pEnd: Position = [Number(rightBound.toFixed(4)), Number((cy - archDy * 0.25).toFixed(4))];

    const meta = polityMap.get(entry.polity_id);
    const primary = meta?.name_zh ?? entry.polity_id;
    const sec = meta?.name_original_script?.trim();
    const combined = !sec || typography.bilingual_mode === "NONE"
      ? primary
      : typography.bilingual_mode === "INLINE"
        ? `${primary} (${sec})`
        : `${primary}\n${sec}`;

    features.push({
      type: "Feature",
      id: `spine-${entry.polity_id}`,
      geometry: { type: "LineString", coordinates: [pStart, pMid, pEnd] },
      properties: {
        polity_id: entry.polity_id,
        label_text: combined,
        label_primary: primary,
        ...(sec && typography.bilingual_mode !== "NONE" ? { label_secondary: sec } : {}),
        center: [cx, midY],
        letter_spacing_em: typography.letter_spacing_em,
        rank_weight: Math.round(Math.abs(ringSignedArea(bestRing)) * 100),
      },
    });
  }
  return features;
}

export function polygonCentroid(poly: Polygon): [number, number] {
  const ring = poly.coordinates[0] ?? [];
  if (ring.length < 3) return [0, 0];
  return computePolylabel(ring).center;
}
