import type {
  ComposableStylePack,
  GateIssue,
  GateResult,
  HistoricalToponym,
  MapSnapshot,
} from "@historical-cartography/shared-schema";
import type { Feature, LineString, Polygon, Position } from "geojson";
import type { PolityMetadata } from "../data/demo-types.ts";

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

export function boxesIntersect(a: ScreenBox, b: ScreenBox, paddingPx = 4): boolean {
  return !(
    a.x + a.width + paddingPx <= b.x
    || b.x + b.width + paddingPx <= a.x
    || a.y + a.height + paddingPx <= b.y
    || b.y + b.height + paddingPx <= a.y
  );
}

/**
 * Simple deterministic WebMercator projection for viewport collision measurement
 * in both live DOM and headless/Node contract tests.
 */
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
  const cx = mercX(center[0]);
  const cy = mercY(center[1]);
  const px = mercX(lonLat[0]) - cx + viewportWidth / 2;
  const py = mercY(lonLat[1]) - cy + viewportHeight / 2;
  return [px, py];
}

export function evaluateToponymLayout(params: {
  toponyms: readonly HistoricalToponym[];
  typography: ComposableStylePack["typography"];
  center: [number, number];
  zoom: number;
  viewport: { width: number; height: number };
  high_priority_threshold?: number;
  projectPoint?: (lonLat: [number, number]) => [number, number];
}): LabelLayoutReport {
  const threshold = params.high_priority_threshold ?? 80;
  const sorted = [...params.toponyms].sort((a, b) => {
    if (b.label_priority !== a.label_priority) return b.label_priority - a.label_priority;
    return a.toponym_id.localeCompare(b.toponym_id);
  });

  const acceptedBoxes: Array<{ id: string; box: ScreenBox }> = [];
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
    const charWidth = top.entity_rank === "CAPITAL" ? 13 : 11;
    const width = Math.max(44, parts.primary.length * charWidth + 14);
    const height = parts.secondary && params.typography.bilingual_mode === "STACKED" ? 34 : 20;
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
    viewport: {
      width: params.viewport.width,
      height: params.viewport.height,
      zoom: params.zoom,
    },
    high_priority_threshold: threshold,
    placed,
    hidden_ids: hiddenIds,
    high_priority_collision_count: issues.length,
    g5_label_gate: {
      gate: "G5",
      passed: issues.length === 0,
      issues,
    },
  };
}

/**
 * Compute gentle medial-axis spine lines across each polity's combined faces
 * so MapLibre symbol layers can render curved wide-tracked Songti polity titles.
 */
export function buildPolitySpineLabels(
  snapshot: MapSnapshot,
  polities: readonly PolityMetadata[],
  typography: ComposableStylePack["typography"],
): Array<Feature<LineString, { polity_id: string; label_text: string; rank_weight: number }>> {
  const polityMap = new Map<string, PolityMetadata>();
  for (const p of polities) polityMap.set(p.polity_id, p);

  const coordsByPolity = new Map<string, Position[]>();
  for (const feat of snapshot.territories.features) {
    const pid = feat.properties.polity_id ?? feat.properties.face_id;
    const list = coordsByPolity.get(pid) ?? [];
    const outer = feat.geometry.coordinates[0] ?? [];
    for (const pt of outer) list.push(pt);
    coordsByPolity.set(pid, list);
  }

  const features: Array<Feature<LineString, { polity_id: string; label_text: string; rank_weight: number }>> = [];
  for (const [polityId, pts] of coordsByPolity.entries()) {
    if (pts.length < 3) continue;
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    let sumX = 0;
    let sumY = 0;
    for (const p of pts) {
      const x = p[0] ?? 0;
      const y = p[1] ?? 0;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      sumX += x;
      sumY += y;
    }
    const cx = sumX / pts.length;
    const cy = sumY / pts.length;
    const spanX = Math.max(1.2, (maxX - minX) * 0.52);
    const spanY = Math.max(0.4, (maxY - minY) * 0.14);

    const pStart: Position = [Number((cx - spanX / 2).toFixed(4)), Number((cy - spanY * 0.35).toFixed(4))];
    const pMid: Position = [Number(cx.toFixed(4)), Number((cy + (typography.curved_along_spine ? spanY * 0.45 : 0)).toFixed(4))];
    const pEnd: Position = [Number((cx + spanX / 2).toFixed(4)), Number((cy - spanY * 0.25).toFixed(4))];

    const meta = polityMap.get(polityId);
    const baseName = meta?.name_zh ?? polityId;
    const spaced = typography.letter_spacing_em >= 0.3
      ? Array.from(baseName).join(" ")
      : baseName;

    features.push({
      type: "Feature",
      id: `spine-${polityId}`,
      geometry: {
        type: "LineString",
        coordinates: [pStart, pMid, pEnd],
      },
      properties: {
        polity_id: polityId,
        label_text: spaced,
        rank_weight: pts.length,
      },
    });
  }
  return features;
}

export function polygonCentroid(poly: Polygon): [number, number] {
  const ring = poly.coordinates[0] ?? [];
  if (ring.length === 0) return [0, 0];
  let sx = 0;
  let sy = 0;
  for (const pt of ring) {
    sx += pt[0] ?? 0;
    sy += pt[1] ?? 0;
  }
  return [sx / ring.length, sy / ring.length];
}
