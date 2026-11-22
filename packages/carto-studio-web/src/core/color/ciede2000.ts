import type { ComposableStylePack, MapSnapshot } from "@historical-cartography/shared-schema";
import type { PolityMetadata } from "../data/demo-types.ts";
import { PALETTE_THEMES } from "../styles/style-presets.ts";

export interface LabColor {
  L: number;
  a: number;
  b: number;
}

export interface AdjacencyColorPair {
  polity_a: string;
  polity_b: string;
  color_a: string;
  color_b: string;
  delta_e_2000: number;
  passes_threshold: boolean;
}

export interface PaletteSolveReport {
  palette_id: string;
  min_delta_e_threshold: number;
  colors_by_polity: Record<string, string>;
  adjacency_pairs: AdjacencyColorPair[];
  min_measured_delta_e: number;
  all_adjacent_clear: boolean;
  inherited_polities: string[];
}

export function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.trim().replace(/^#/, "");
  if (clean.length === 3) {
    const r = Number.parseInt((clean[0] ?? "0") + (clean[0] ?? "0"), 16);
    const g = Number.parseInt((clean[1] ?? "0") + (clean[1] ?? "0"), 16);
    const b = Number.parseInt((clean[2] ?? "0") + (clean[2] ?? "0"), 16);
    return [r, g, b];
  }
  const r = Number.parseInt(clean.slice(0, 2) || "00", 16);
  const g = Number.parseInt(clean.slice(2, 4) || "00", 16);
  const b = Number.parseInt(clean.slice(4, 6) || "00", 16);
  return [
    Number.isFinite(r) ? r : 0,
    Number.isFinite(g) ? g : 0,
    Number.isFinite(b) ? b : 0,
  ];
}

export function rgbToHex(r: number, g: number, b: number): string {
  const clamp = (v: number): string =>
    Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0");
  return `#${clamp(r)}${clamp(g)}${clamp(b)}`;
}

export function hexToHsl(hex: string): [number, number, number] {
  const [r8, g8, b8] = hexToRgb(hex);
  const r = r8 / 255;
  const g = g8 / 255;
  const b = b8 / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r:
        h = (g - b) / d + (g < b ? 6 : 0);
        break;
      case g:
        h = (b - r) / d + 2;
        break;
      default:
        h = (r - g) / d + 4;
        break;
    }
    h *= 60;
  }
  return [h, s * 100, l * 100];
}

export function hslToHex(h: number, s: number, l: number): string {
  const hue = ((h % 360) + 360) % 360;
  const sat = Math.max(0, Math.min(100, s)) / 100;
  const light = Math.max(0, Math.min(100, l)) / 100;
  const c = (1 - Math.abs(2 * light - 1)) * sat;
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = light - c / 2;
  let rp = 0;
  let gp = 0;
  let bp = 0;
  if (hue < 60) [rp, gp, bp] = [c, x, 0];
  else if (hue < 120) [rp, gp, bp] = [x, c, 0];
  else if (hue < 180) [rp, gp, bp] = [0, c, x];
  else if (hue < 240) [rp, gp, bp] = [0, x, c];
  else if (hue < 300) [rp, gp, bp] = [x, 0, c];
  else [rp, gp, bp] = [c, 0, x];
  return rgbToHex((rp + m) * 255, (gp + m) * 255, (bp + m) * 255);
}

export function hexToLab(hex: string): LabColor {
  const [r8, g8, b8] = hexToRgb(hex);
  const linearize = (v: number): number => {
    const s = v / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  const r = linearize(r8);
  const g = linearize(g8);
  const b = linearize(b8);

  // sRGB -> XYZ (D65)
  const x = (r * 0.4124564 + g * 0.3575761 + b * 0.1804375) / 0.95047;
  const y = (r * 0.2126729 + g * 0.7151522 + b * 0.072175) / 1.0;
  const z = (r * 0.0193339 + g * 0.119192 + b * 0.9503041) / 1.08883;

  const f = (t: number): number => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const fx = f(x);
  const fy = f(y);
  const fz = f(z);

  return {
    L: 116 * fy - 16,
    a: 500 * (fx - fy),
    b: 200 * (fy - fz),
  };
}

/**
 * Exact CIEDE2000 perceptual color difference (ΔE₀₀).
 */
export function ciede2000(hexA: string, hexB: string): number {
  const lab1 = hexToLab(hexA);
  const lab2 = hexToLab(hexB);

  const deg2rad = (deg: number): number => (deg * Math.PI) / 180;
  const rad2deg = (rad: number): number => (rad * 180) / Math.PI;

  const c1 = Math.hypot(lab1.a, lab1.b);
  const c2 = Math.hypot(lab2.a, lab2.b);
  const cBar = (c1 + c2) / 2;
  const cBar7 = cBar ** 7;
  const g = 0.5 * (1 - Math.sqrt(cBar7 / (cBar7 + 25 ** 7)));

  const a1Prime = (1 + g) * lab1.a;
  const a2Prime = (1 + g) * lab2.a;
  const c1Prime = Math.hypot(a1Prime, lab1.b);
  const c2Prime = Math.hypot(a2Prime, lab2.b);

  const calcHuePrime = (bVal: number, aPrime: number): number => {
    if (bVal === 0 && aPrime === 0) return 0;
    const angle = rad2deg(Math.atan2(bVal, aPrime));
    return angle >= 0 ? angle : angle + 360;
  };
  const h1Prime = calcHuePrime(lab1.b, a1Prime);
  const h2Prime = calcHuePrime(lab2.b, a2Prime);

  const deltaLPrime = lab2.L - lab1.L;
  const deltaCPrime = c2Prime - c1Prime;

  let deltahPrime = 0;
  if (c1Prime * c2Prime !== 0) {
    const diff = h2Prime - h1Prime;
    if (Math.abs(diff) <= 180) deltahPrime = diff;
    else if (diff > 180) deltahPrime = diff - 360;
    else deltahPrime = diff + 360;
  }
  const deltaHPrime = 2 * Math.sqrt(c1Prime * c2Prime) * Math.sin(deg2rad(deltahPrime / 2));

  const lBarPrime = (lab1.L + lab2.L) / 2;
  const cBarPrime = (c1Prime + c2Prime) / 2;

  let hBarPrime = h1Prime + h2Prime;
  if (c1Prime * c2Prime !== 0) {
    if (Math.abs(h1Prime - h2Prime) <= 180) hBarPrime = (h1Prime + h2Prime) / 2;
    else if (h1Prime + h2Prime < 360) hBarPrime = (h1Prime + h2Prime + 360) / 2;
    else hBarPrime = (h1Prime + h2Prime - 360) / 2;
  }

  const t = 1
    - 0.17 * Math.cos(deg2rad(hBarPrime - 30))
    + 0.24 * Math.cos(deg2rad(2 * hBarPrime))
    + 0.32 * Math.cos(deg2rad(3 * hBarPrime + 6))
    - 0.2 * Math.cos(deg2rad(4 * hBarPrime - 63));

  const deltaTheta = 30 * Math.exp(-(((hBarPrime - 275) / 25) ** 2));
  const cBarPrime7 = cBarPrime ** 7;
  const rc = 2 * Math.sqrt(cBarPrime7 / (cBarPrime7 + 25 ** 7));
  const l50sq = (lBarPrime - 50) ** 2;
  const sl = 1 + (0.015 * l50sq) / Math.sqrt(20 + l50sq);
  const sc = 1 + 0.045 * cBarPrime;
  const sh = 1 + 0.015 * cBarPrime * t;
  const rt = -Math.sin(deg2rad(2 * deltaTheta)) * rc;

  return Math.sqrt(
    (deltaLPrime / sl) ** 2
    + (deltaCPrime / sc) ** 2
    + (deltaHPrime / sh) ** 2
    + rt * (deltaCPrime / sc) * (deltaHPrime / sh),
  );
}

/**
 * Extract polity-to-polity adjacency pairs directly from SharedBoundaryArc `left_face_id` / `right_face_id`.
 */
export function extractPolityAdjacency(snapshot: MapSnapshot): Map<string, Set<string>> {
  const faceToPolity = new Map<string, string>();
  for (const feat of snapshot.territories.features) {
    const faceId = feat.properties.face_id;
    const polityId = feat.properties.polity_id ?? faceId;
    faceToPolity.set(faceId, polityId);
  }

  const adjacency = new Map<string, Set<string>>();
  const ensureNode = (id: string): Set<string> => {
    let s = adjacency.get(id);
    if (!s) {
      s = new Set<string>();
      adjacency.set(id, s);
    }
    return s;
  };

  for (const feat of snapshot.territories.features) {
    const polityId = feat.properties.polity_id ?? feat.properties.face_id;
    ensureNode(polityId);
  }

  for (const boundary of snapshot.boundaries.features) {
    const leftId = boundary.properties.left_face_id;
    const rightId = boundary.properties.right_face_id;
    if (!leftId || !rightId) continue;
    const pLeft = faceToPolity.get(leftId);
    const pRight = faceToPolity.get(rightId);
    if (!pLeft || !pRight || pLeft === pRight) continue;
    ensureNode(pLeft).add(pRight);
    ensureNode(pRight).add(pLeft);
  }

  return adjacency;
}

/**
 * Derive a child polity color variant from its parent polity color gene
 * while keeping perceptual distance when adjacent to the parent or siblings.
 */
export function deriveInheritedPolityColor(parentHex: string, variantIndex: number): string {
  const [h, s, l] = hexToHsl(parentHex);
  const hueOffset = (variantIndex % 2 === 0 ? 1 : -1) * (14 + variantIndex * 8);
  const lightOffset = variantIndex % 2 === 0 ? 11 : -11;
  return hslToHex(h + hueOffset, Math.max(28, Math.min(82, s - 6)), Math.max(26, Math.min(72, l + lightOffset)));
}

/**
 * Solve anti-collision polity colors across topology neighbors using CIEDE2000 ΔE
 * and polity lineage color inheritance.
 */
export function solvePolityPalette(params: {
  snapshot: MapSnapshot;
  polities: readonly PolityMetadata[];
  palette_id: string;
  auto_four_color_solver: boolean;
  min_delta_e?: number;
  manual_overrides?: Readonly<Record<string, string>>;
}): PaletteSolveReport {
  const minDeltaE = params.min_delta_e ?? 18;
  const adjacency = extractPolityAdjacency(params.snapshot);
  const polityMap = new Map<string, PolityMetadata>();
  for (const p of params.polities) polityMap.set(p.polity_id, p);

  const theme = PALETTE_THEMES[params.palette_id] ?? PALETTE_THEMES["palette-vivid-narrative"]!;
  const themeColors = theme.colors;

  const lineageDepth = (id: string): number => {
    let d = 0;
    let cur = polityMap.get(id)?.parent_polity_id;
    const seen = new Set<string>([id]);
    while (cur && !seen.has(cur) && d < 16) {
      seen.add(cur);
      d += 1;
      cur = polityMap.get(cur)?.parent_polity_id;
    }
    return d;
  };

  // Parent-before-child topological order, then highest adjacency degree first
  const polityIds = Array.from(adjacency.keys()).sort((a, b) => {
    const depthDiff = lineageDepth(a) - lineageDepth(b);
    if (depthDiff !== 0) return depthDiff;
    const degDiff = (adjacency.get(b)?.size ?? 0) - (adjacency.get(a)?.size ?? 0);
    return degDiff !== 0 ? degDiff : a.localeCompare(b);
  });

  const colorsByPolity: Record<string, string> = {};
  const inheritedPolities: string[] = [];
  const childVariantCounter = new Map<string, number>();

  for (let i = 0; i < polityIds.length; i++) {
    const polityId = polityIds[i]!;
    const manual = params.manual_overrides?.[polityId];
    if (manual) {
      colorsByPolity[polityId] = manual;
      continue;
    }

    const meta = polityMap.get(polityId);
    const parentId = meta?.parent_polity_id;
    const parentColor = parentId ? colorsByPolity[parentId] : undefined;

    if (!params.auto_four_color_solver) {
      if (parentColor && parentId) {
        inheritedPolities.push(polityId);
        const variantIdx = (childVariantCounter.get(parentId) ?? 0) + 1;
        childVariantCounter.set(parentId, variantIdx);
        colorsByPolity[polityId] = deriveInheritedPolityColor(parentColor, variantIdx);
      } else {
        colorsByPolity[polityId] = meta?.preferred_hex ?? themeColors[i % themeColors.length]!;
      }
      continue;
    }

    const neighbors = Array.from(adjacency.get(polityId) ?? []);
    const candidates: string[] = [];
    if (parentColor && parentId) {
      inheritedPolities.push(polityId);
      const baseIdx = (childVariantCounter.get(parentId) ?? 0) + 1;
      childVariantCounter.set(parentId, baseIdx);
      candidates.push(
        deriveInheritedPolityColor(parentColor, baseIdx),
        deriveInheritedPolityColor(parentColor, baseIdx + 1),
        deriveInheritedPolityColor(parentColor, baseIdx + 2),
      );
    }
    if (meta?.preferred_hex) {
      candidates.push(meta.preferred_hex);
    }
    for (let k = 0; k < themeColors.length; k++) {
      candidates.push(themeColors[(i + k) % themeColors.length]!);
    }
    // High-contrast shifted backups if theme pool is tight
    for (let hShift = 0; hShift < 12; hShift++) {
      candidates.push(hslToHex((hShift * 31 + i * 53) % 360, 62, hShift % 2 === 0 ? 46 : 60));
    }

    let chosen = candidates[0]!;
    let bestMinDist = -1;
    for (const candidate of candidates) {
      let minDist = Infinity;
      for (const nId of neighbors) {
        const nColor = colorsByPolity[nId];
        if (!nColor) continue;
        const d = ciede2000(candidate, nColor);
        if (d < minDist) minDist = d;
      }
      if (minDist >= minDeltaE) {
        chosen = candidate;
        bestMinDist = minDist;
        break;
      }
      if (minDist > bestMinDist) {
        bestMinDist = minDist;
        chosen = candidate;
      }
    }
    colorsByPolity[polityId] = chosen;
  }

  const pairs: AdjacencyColorPair[] = [];
  const seenPairs = new Set<string>();
  let minMeasured = Infinity;

  for (const [polityA, neighbors] of adjacency.entries()) {
    for (const polityB of neighbors) {
      const pairKey = polityA < polityB ? `${polityA}::${polityB}` : `${polityB}::${polityA}`;
      if (seenPairs.has(pairKey)) continue;
      seenPairs.add(pairKey);
      const colorA = colorsByPolity[polityA] ?? "#64748b";
      const colorB = colorsByPolity[polityB] ?? "#94a3b8";
      const de = Number(ciede2000(colorA, colorB).toFixed(2));
      if (de < minMeasured) minMeasured = de;
      pairs.push({
        polity_a: polityA,
        polity_b: polityB,
        color_a: colorA,
        color_b: colorB,
        delta_e_2000: de,
        passes_threshold: de >= minDeltaE,
      });
    }
  }

  if (pairs.length === 0) minMeasured = 100;

  return {
    palette_id: params.palette_id,
    min_delta_e_threshold: minDeltaE,
    colors_by_polity: colorsByPolity,
    adjacency_pairs: pairs,
    min_measured_delta_e: minMeasured,
    all_adjacent_clear: pairs.every((p) => p.passes_threshold),
    inherited_polities: inheritedPolities,
  };
}

/**
 * Evaluate face fill opacity & saturation scale from `control_score` (0..100)
 * using the active `ComposableStylePack["territory_rendering"]` stops.
 */
export function evaluateControlScoreVisuals(
  baseHex: string,
  controlScore: number,
  territoryRendering: ComposableStylePack["territory_rendering"],
  baseMode: "PURE_TERRITORY" | "CONTROL_INTENSITY",
  renderMode: "OPACITY_GRADIENT" | "COLOR_RAMP" | "CLOSED_ISOPLETH_CONTOURS" = "OPACITY_GRADIENT",
  adjustments?: { opacity_multiplier?: number; saturation_multiplier?: number },
): { fill_hex: string; fill_opacity: number; contour_dasharray?: number[] } {
  const opMult = adjustments?.opacity_multiplier ?? 1.0;
  const satMult = adjustments?.saturation_multiplier ?? 1.0;
  const scaleOpacity = (raw: number): number =>
    Number(Math.max(0.04, Math.min(0.98, raw * opMult)).toFixed(3));
  const scaleHex = (rawHex: string): string => {
    if (Math.abs(satMult - 1) < 0.01) return rawHex;
    const [h, s, l] = hexToHsl(rawHex);
    return hslToHex(h, Math.max(0, Math.min(100, s * satMult)), l);
  };

  if (baseMode === "PURE_TERRITORY") {
    return {
      fill_hex: scaleHex(baseHex),
      fill_opacity: scaleOpacity(territoryRendering.pure_mode_fill_opacity),
    };
  }

  const clamped = Math.max(0, Math.min(100, controlScore));
  const stops = [...territoryRendering.control_score_stops].sort((a, b) => a.score - b.score);
  if (stops.length === 0) {
    return { fill_hex: scaleHex(baseHex), fill_opacity: scaleOpacity((clamped / 100) * 0.85 + 0.08) };
  }

  let lower = stops[0]!;
  let upper = stops[stops.length - 1]!;
  for (let i = 0; i < stops.length - 1; i++) {
    const cur = stops[i]!;
    const nxt = stops[i + 1]!;
    if (clamped >= cur.score && clamped <= nxt.score) {
      lower = cur;
      upper = nxt;
      break;
    }
  }

  const span = Math.max(1e-6, upper.score - lower.score);
  const t = upper.score === lower.score ? 0 : Math.max(0, Math.min(1, (clamped - lower.score) / span));
  const opacity = lower.opacity + (upper.opacity - lower.opacity) * t;
  const satScale = (lower.saturation_scale + (upper.saturation_scale - lower.saturation_scale) * t) * satMult;

  const [h, s, l] = hexToHsl(baseHex);
  const adjustedHex = renderMode === "COLOR_RAMP"
    ? hslToHex(h, Math.max(0, Math.min(100, s * satScale)), Math.min(82, l + (1 - clamped / 100) * 26))
    : hslToHex(h, Math.max(0, Math.min(100, s * satScale)), l);

  const dash = lower.contour_stroke_dasharray;
  return {
    fill_hex: adjustedHex,
    fill_opacity: scaleOpacity(opacity),
    ...(dash ? { contour_dasharray: dash } : {}),
  };
}
