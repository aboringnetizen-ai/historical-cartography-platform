import type {
  AdminUnit,
  BoundaryCertainty,
  BoundarySmoothnessProfile,
  CredibilityTier,
  EpochRange,
  MapBoundaryProperties,
  MapFaceProperties,
  MapSnapshot,
  SharedBoundaryArc,
  TerritorialFace,
} from "@historical-cartography/shared-schema";
import type { Feature, LineString, Polygon, Position } from "geojson";

export function pointsEqual(a: Position, b: Position, eps = 1e-8): boolean {
  return Math.abs((a[0] ?? 0) - (b[0] ?? 0)) < eps && Math.abs((a[1] ?? 0) - (b[1] ?? 0)) < eps;
}

export function ringSignedArea(ring: readonly Position[]): number {
  if (ring.length < 3) return 0;
  let sum = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]!;
    const b = ring[(i + 1) % ring.length]!;
    sum += (a[0] ?? 0) * (b[1] ?? 0) - (b[0] ?? 0) * (a[1] ?? 0);
  }
  return sum * 0.5;
}

export function normalizeRingWinding(ring: readonly Position[], ccw: boolean): Position[] {
  const closed = ring.map((p) => [p[0] ?? 0, p[1] ?? 0] as Position);
  if (closed.length >= 2 && !pointsEqual(closed[0]!, closed[closed.length - 1]!)) {
    closed.push([closed[0]![0] ?? 0, closed[0]![1] ?? 0]);
  }
  const area = ringSignedArea(closed);
  const isCcw = area >= 0;
  if (isCcw !== ccw) {
    closed.reverse();
  }
  return closed;
}

export function haversineKm(a: Position, b: Position): number {
  const rad = Math.PI / 180;
  const lat1 = (a[1] ?? 0) * rad;
  const lat2 = (b[1] ?? 0) * rad;
  const dLat = lat2 - lat1;
  const dLon = ((b[0] ?? 0) - (a[0] ?? 0)) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(Math.max(0, h))));
}

function pointToSegmentDistanceKm(p: Position, a: Position, b: Position): number {
  const midLatRad = (((a[1] ?? 0) + (b[1] ?? 0) + (p[1] ?? 0)) / 3) * (Math.PI / 180);
  const kmPerDegLat = 111.132;
  const kmPerDegLon = 111.32 * Math.max(0.15, Math.cos(midLatRad));
  const ax = (a[0] ?? 0) * kmPerDegLon;
  const ay = (a[1] ?? 0) * kmPerDegLat;
  const bx = (b[0] ?? 0) * kmPerDegLon;
  const by = (b[1] ?? 0) * kmPerDegLat;
  const px = (p[0] ?? 0) * kmPerDegLon;
  const py = (p[1] ?? 0) * kmPerDegLat;

  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  if (lenSq <= 1e-12) return Math.hypot(px - ax, py - ay);
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lenSq));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

export function measureMaxHausdorffDeviationKm(canonical: LineString, rendered: LineString): number {
  const cPts = canonical.coordinates;
  const rPts = rendered.coordinates;
  if (cPts.length < 2 || rPts.length < 2) return 0;

  let maxDev = 0;
  for (const pt of rPts) {
    let best = Infinity;
    for (let i = 0; i < cPts.length - 1; i++) {
      const d = pointToSegmentDistanceKm(pt, cPts[i]!, cPts[i + 1]!);
      if (d < best) best = d;
    }
    if (best > maxDev) maxDev = best;
  }
  for (const pt of cPts) {
    let best = Infinity;
    for (let i = 0; i < rPts.length - 1; i++) {
      const d = pointToSegmentDistanceKm(pt, rPts[i]!, rPts[i + 1]!);
      if (d < best) best = d;
    }
    if (best > maxDev) maxDev = best;
  }
  return Number(maxDev.toFixed(2));
}

function polylineLengthKm(pts: readonly Position[]): number {
  let len = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    len += haversineKm(pts[i]!, pts[i + 1]!);
  }
  return len;
}

function measureWalkLengthAtRuler(pts: readonly Position[], rulerKm: number): number {
  if (pts.length < 2 || rulerKm <= 1e-6) return 0;
  let steps = 0;
  let cur = pts[0]!;
  let idx = 1;
  while (idx < pts.length) {
    const nxt = pts[idx]!;
    const segLen = haversineKm(cur, nxt);
    if (segLen >= rulerKm) {
      const ratio = rulerKm / segLen;
      cur = [
        (cur[0] ?? 0) + ((nxt[0] ?? 0) - (cur[0] ?? 0)) * ratio,
        (cur[1] ?? 0) + ((nxt[1] ?? 0) - (cur[1] ?? 0)) * ratio,
      ];
      steps += 1;
    } else {
      idx += 1;
    }
  }
  const rem = haversineKm(cur, pts[pts.length - 1]!);
  const totalSteps = steps + rem / rulerKm;
  return totalSteps * rulerKm;
}

/**
 * Measure polyline fractal dimension via multi-scale Richardson divider regression.
 */
export function measureArcFractalDimension(line: LineString): number {
  const pts = line.coordinates;
  if (pts.length < 4) return 1.0;
  const totalKm = polylineLengthKm(pts);
  if (totalKm <= 1) return 1.0;

  const scales = [totalKm / 4, totalKm / 7, totalKm / 12, totalKm / 20];
  const xs: number[] = [];
  const ys: number[] = [];
  for (const r of scales) {
    if (r <= 0.25) continue;
    const measured = measureWalkLengthAtRuler(pts, r);
    if (measured > 0) {
      xs.push(Math.log(r));
      ys.push(Math.log(measured));
    }
  }
  if (xs.length < 2) return 1.0;

  const n = xs.length;
  const meanX = xs.reduce((s, v) => s + v, 0) / n;
  const meanY = ys.reduce((s, v) => s + v, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i]! - meanX;
    num += dx * (ys[i]! - meanY);
    den += dx * dx;
  }
  const slope = den > 1e-12 ? num / den : 0;
  const d = 1 - slope;
  return Number(Math.max(1.0, Math.min(1.6, d)).toFixed(3));
}

function simplifyVisvalingam(pts: readonly Position[], areaRatio: number): Position[] {
  if (areaRatio <= 0 || pts.length <= 5) return pts.map((p) => [p[0] ?? 0, p[1] ?? 0]);
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of pts) {
    const x = p[0] ?? 0;
    const y = p[1] ?? 0;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const thresholdArea = Math.max(1e-8, (maxX - minX) * (maxY - minY) * areaRatio);
  const working = pts.map((p) => [p[0] ?? 0, p[1] ?? 0] as Position);
  while (working.length > 4) {
    let minArea = Infinity;
    let minIdx = -1;
    for (let i = 1; i < working.length - 1; i++) {
      const a = working[i - 1]!;
      const b = working[i]!;
      const c = working[i + 1]!;
      const area = Math.abs(
        ((a[0] ?? 0) * ((b[1] ?? 0) - (c[1] ?? 0))
          + (b[0] ?? 0) * ((c[1] ?? 0) - (a[1] ?? 0))
          + (c[0] ?? 0) * ((a[1] ?? 0) - (b[1] ?? 0))) * 0.5,
      );
      if (area < minArea) {
        minArea = area;
        minIdx = i;
      }
    }
    if (minIdx <= 0 || minArea >= thresholdArea) break;
    working.splice(minIdx, 1);
  }
  return working;
}

/**
 * Derive a tension- & Hausdorff-bounded smooth curve without mutating `canonical_geometry`.
 * Start and end nodes remain strictly locked so shared arcs stay zero-gap watertight.
 */
export function deriveBoundedSplineGeometry(
  canonical: LineString,
  profileOrTension: number | BoundarySmoothnessProfile = 0.55,
): LineString {
  const tension = typeof profileOrTension === "number" ? profileOrTension : profileOrTension.spline_tension;
  const areaRatio = typeof profileOrTension === "number" ? 0.00002 : profileOrTension.simplify_area_ratio;
  const maxHausdorffKm = typeof profileOrTension === "number" ? 25 : profileOrTension.max_hausdorff_deviation_km;

  const rawPts = canonical.coordinates;
  if (rawPts.length <= 2) {
    return { type: "LineString", coordinates: rawPts.map((p) => [p[0] ?? 0, p[1] ?? 0]) };
  }

  const isUltraDense = rawPts.length > 35;
  if (isUltraDense) {
    const out: Position[] = [[rawPts[0]![0] ?? 0, rawPts[0]![1] ?? 0]];
    const w = Math.max(0, Math.min(0.22, (1 - tension) * 0.35));
    for (let i = 1; i < rawPts.length - 1; i++) {
      const a = rawPts[i - 1]!;
      const b = rawPts[i]!;
      const c = rawPts[i + 1]!;
      const x = (a[0] ?? 0) * w + (b[0] ?? 0) * (1 - 2 * w) + (c[0] ?? 0) * w;
      const y = (a[1] ?? 0) * w + (b[1] ?? 0) * (1 - 2 * w) + (c[1] ?? 0) * w;
      out.push([Number(x.toFixed(5)), Number(y.toFixed(5))]);
    }
    const lastPt = rawPts[rawPts.length - 1]!;
    out.push([lastPt[0] ?? 0, lastPt[1] ?? 0]);
    const ultraCandidate: LineString = { type: "LineString", coordinates: out };
    return measureMaxHausdorffDeviationKm(canonical, ultraCandidate) <= maxHausdorffKm
      ? ultraCandidate
      : { type: "LineString", coordinates: rawPts.map((p) => [p[0] ?? 0, p[1] ?? 0]) };
  }

  const isDenseGis = rawPts.length > 18;
  const pts = isDenseGis ? rawPts : simplifyVisvalingam(rawPts, areaRatio);
  const first = rawPts[0]!;
  const last = rawPts[rawPts.length - 1]!;

  const evaluateTension = (tau: number): LineString => {
    const out: Position[] = [[first[0] ?? 0, first[1] ?? 0]];
    const alpha = Math.max(0.04, Math.min(0.45, (1 - tau) * 0.45));
    const subdivisions = isDenseGis ? [0.5] : pts.length > 12 ? [0.333, 0.667] : [0.2, 0.4, 0.6, 0.8];

    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[Math.max(0, i - 1)] ?? first;
      const p1 = pts[i] ?? first;
      const p2 = pts[i + 1] ?? p1;
      const p3 = pts[Math.min(pts.length - 1, i + 2)] ?? p2;

      if (i > 0) out.push([p1[0] ?? 0, p1[1] ?? 0]);
      for (const t of subdivisions) {
        const t2 = t * t;
        const t3 = t2 * t;
        const m1x = alpha * ((p2[0] ?? 0) - (p0[0] ?? 0));
        const m1y = alpha * ((p2[1] ?? 0) - (p0[1] ?? 0));
        const m2x = alpha * ((p3[0] ?? 0) - (p1[0] ?? 0));
        const m2y = alpha * ((p3[1] ?? 0) - (p1[1] ?? 0));

        const h00 = 2 * t3 - 3 * t2 + 1;
        const h10 = t3 - 2 * t2 + t;
        const h01 = -2 * t3 + 3 * t2;
        const h11 = t3 - t2;

        const x = h00 * (p1[0] ?? 0) + h10 * m1x + h01 * (p2[0] ?? 0) + h11 * m2x;
        const y = h00 * (p1[1] ?? 0) + h10 * m1y + h01 * (p2[1] ?? 0) + h11 * m2y;
        out.push([Number(x.toFixed(5)), Number(y.toFixed(5))]);
      }
    }
    out.push([last[0] ?? 0, last[1] ?? 0]);
    return { type: "LineString", coordinates: out };
  };

  let curTau = Math.max(isDenseGis ? 0.74 : 0.1, Math.min(0.95, tension));
  let candidate = evaluateTension(curTau);
  let attempts = 0;
  while (measureMaxHausdorffDeviationKm(canonical, candidate) > maxHausdorffKm && attempts < 4) {
    curTau = Math.min(0.98, curTau + (1 - curTau) * 0.5);
    candidate = evaluateTension(curTau);
    attempts += 1;
  }
  return candidate;
}

/**
 * Assemble closed zero-gap polygon rings directly from shared boundary arcs.
 * Exterior infinite face is represented by `null` in MapBoundaryProperties.
 */
export function buildSnapshotFromSharedTopology(
  epoch: EpochRange,
  revision_id: string,
  data_status: MapSnapshot["data_status"],
  arcs: readonly SharedBoundaryArc[],
  faces: readonly TerritorialFace[],
  useRenderedSpline = true,
  interiorHoleArcIdsByFaceId?: Readonly<Record<string, readonly string[]>>,
): MapSnapshot {
  const arcById = new Map<string, SharedBoundaryArc>();
  for (const arc of arcs) arcById.set(arc.arc_id, arc);

  const faceFeatures: Array<Feature<Polygon, MapFaceProperties>> = [];
  for (const face of faces) {
    const ring: Position[] = [];
    let currentEnd: Position | undefined;

    for (let idx = 0; idx < face.boundary_arc_ids.length; idx++) {
      const arcId = face.boundary_arc_ids[idx];
      if (!arcId) continue;
      const arc = arcById.get(arcId);
      if (!arc) throw new Error(`Missing shared arc ${arcId} for face ${face.face_id}`);
      const geom = useRenderedSpline && arc.rendered_spline_geometry
        ? arc.rendered_spline_geometry
        : arc.canonical_geometry;
      const coords = geom.coordinates;
      if (coords.length < 2) continue;

      const firstPt = coords[0]!;
      const lastPt = coords[coords.length - 1]!;
      let ordered: Position[];
      if (idx === 0) {
        const nextArc = face.boundary_arc_ids[1] ? arcById.get(face.boundary_arc_ids[1]!) : undefined;
        const nextGeom = nextArc
          ? (useRenderedSpline && nextArc.rendered_spline_geometry
            ? nextArc.rendered_spline_geometry
            : nextArc.canonical_geometry)
          : undefined;
        const nextStart = nextGeom?.coordinates[0];
        const nextEnd = nextGeom?.coordinates[nextGeom.coordinates.length - 1];
        const forwardConnects = Boolean(
          (nextStart && pointsEqual(lastPt, nextStart))
          || (nextEnd && pointsEqual(lastPt, nextEnd)),
        );
        ordered = forwardConnects || !nextGeom ? coords.slice() : coords.slice().reverse();
      } else if (currentEnd && pointsEqual(currentEnd, firstPt)) {
        ordered = coords.slice();
      } else if (currentEnd && pointsEqual(currentEnd, lastPt)) {
        ordered = coords.slice().reverse();
      } else {
        throw new Error(`Topology gap detected in face ${face.face_id} before arc ${arc.arc_id}`);
      }

      for (let p = idx === 0 ? 0 : 1; p < ordered.length; p++) {
        const pt = ordered[p];
        if (pt) ring.push([pt[0] ?? 0, pt[1] ?? 0]);
      }
      currentEnd = ring[ring.length - 1];
    }

    if (ring.length < 4 || !pointsEqual(ring[0]!, ring[ring.length - 1]!)) {
      throw new Error(`Face ${face.face_id} boundary ring did not close cleanly`);
    }

    const normalizedOuter = normalizeRingWinding(ring, true);
    const props: MapFaceProperties = {
      face_id: face.face_id,
      boundary_arc_ids: [...face.boundary_arc_ids],
      control_score: face.control_score,
      zone_semantics: face.zone_semantics,
      ...(face.polity_id !== undefined ? { polity_id: face.polity_id } : {}),
    };

    const holeArcIds = interiorHoleArcIdsByFaceId?.[face.face_id] ?? [];
    const holeRings: Position[][] = [];
    for (const holeArcId of holeArcIds) {
      const holeArc = arcById.get(holeArcId);
      if (!holeArc) continue;
      const hGeom = useRenderedSpline && holeArc.rendered_spline_geometry
        ? holeArc.rendered_spline_geometry
        : holeArc.canonical_geometry;
      if (hGeom.coordinates.length >= 4) {
        holeRings.push(normalizeRingWinding(hGeom.coordinates, false));
      }
    }

    faceFeatures.push({
      type: "Feature",
      id: face.face_id,
      geometry: { type: "Polygon", coordinates: [normalizedOuter, ...holeRings] },
      properties: props,
    });
  }

  const boundaryFeatures: Array<Feature<LineString, MapBoundaryProperties>> = arcs.map((arc) => {
    const geom = useRenderedSpline && arc.rendered_spline_geometry
      ? arc.rendered_spline_geometry
      : arc.canonical_geometry;
    return {
      type: "Feature",
      id: arc.arc_id,
      geometry: { type: "LineString", coordinates: geom.coordinates.map((p) => [p[0] ?? 0, p[1] ?? 0]) },
      properties: {
        arc_id: arc.arc_id,
        start_node_id: arc.start_node_id,
        end_node_id: arc.end_node_id,
        left_face_id: arc.left_face_id === "EXTERIOR_WORLD" ? null : arc.left_face_id,
        right_face_id: arc.right_face_id === "EXTERIOR_WORLD" ? null : arc.right_face_id,
      },
    };
  });

  return {
    epoch,
    revision_id,
    data_status,
    territories: { type: "FeatureCollection", features: faceFeatures },
    boundaries: { type: "FeatureCollection", features: boundaryFeatures },
  };
}

export interface BoundaryRenderMetadata {
  arc_id: string;
  is_same_polity_internal: boolean;
  admin_tier: 0 | 1 | 2 | 3;
  certainty: BoundaryCertainty;
  human_locked: boolean;
  credibility_tier: Exclude<CredibilityTier, "REJECTED_UNVERIFIED">;
  is_frontline: boolean;
  left_polity_id?: string;
  right_polity_id?: string;
}

/**
 * Derive edge rendering metadata for PURE_TERRITORY seamless fusion,
 * multi_tier_ink hierarchical widths, source_credibility overlays, and battle frontlines.
 */
export function buildBoundaryRenderMetadata(
  snapshot: MapSnapshot,
  canonicalArcs: readonly SharedBoundaryArc[],
  canonicalFaces: readonly TerritorialFace[],
  adminUnits: readonly AdminUnit[],
): Record<string, BoundaryRenderMetadata> {
  const snapFaceById = new Map(snapshot.territories.features.map((f) => [f.properties.face_id, f.properties]));
  const canFaceById = new Map(canonicalFaces.map((f) => [f.face_id, f]));
  const canArcById = new Map(canonicalArcs.map((a) => [a.arc_id, a]));
  const adminById = new Map(adminUnits.map((u) => [u.admin_unit_id, u]));

  const tierScore = (tier: Exclude<CredibilityTier, "REJECTED_UNVERIFIED">): number =>
    tier === "T1_PRIMARY_AND_LOCAL_ACADEMIC" ? 3 : tier === "T2_SECONDARY_SCHOLARLY_OR_CURATED" ? 2 : 1;

  const out: Record<string, BoundaryRenderMetadata> = {};
  for (const b of snapshot.boundaries.features) {
    const arcId = b.properties.arc_id;
    const leftId = b.properties.left_face_id;
    const rightId = b.properties.right_face_id;
    const leftSnap = leftId ? snapFaceById.get(leftId) : undefined;
    const rightSnap = rightId ? snapFaceById.get(rightId) : undefined;
    const leftCan = leftId ? canFaceById.get(leftId) : undefined;
    const rightCan = rightId ? canFaceById.get(rightId) : undefined;
    const canArc = canArcById.get(arcId);

    const leftPid = leftSnap?.polity_id;
    const rightPid = rightSnap?.polity_id;
    const samePolityInternal = Boolean(
      leftSnap
      && rightSnap
      && leftPid
      && leftPid === rightPid
      && leftSnap.zone_semantics === "POLITY_TERRITORY"
      && rightSnap.zone_semantics === "POLITY_TERRITORY",
    );

    let adminTier: 0 | 1 | 2 | 3 = 0;
    if (samePolityInternal) {
      const lLvl = leftCan?.admin_unit_id ? adminById.get(leftCan.admin_unit_id)?.admin_level : undefined;
      const rLvl = rightCan?.admin_unit_id ? adminById.get(rightCan.admin_unit_id)?.admin_level : undefined;
      const maxLvl = Math.max(lLvl ?? 1, rLvl ?? 1);
      adminTier = maxLvl >= 3 ? 3 : maxLvl === 2 ? 2 : 1;
    }

    const lt = leftCan?.highest_credibility_tier ?? "T1_PRIMARY_AND_LOCAL_ACADEMIC";
    const rt = rightCan?.highest_credibility_tier ?? lt;
    const credibilityTier = tierScore(lt) <= tierScore(rt) ? lt : rt;
    const certainty = canArc?.certainty ?? "CERTAIN_EXACT";
    const isFrontline = Boolean(
      certainty === "DISPUTED_SCHOLARLY"
      || leftSnap?.zone_semantics === "DISPUTED_OVERLAP"
      || rightSnap?.zone_semantics === "DISPUTED_OVERLAP"
      || (leftPid && rightPid && leftPid !== rightPid),
    );

    out[arcId] = {
      arc_id: arcId,
      is_same_polity_internal: samePolityInternal,
      admin_tier: adminTier,
      certainty,
      human_locked: Boolean(canArc?.human_locked_override),
      credibility_tier: credibilityTier,
      is_frontline: isFrontline,
      ...(leftPid !== undefined ? { left_polity_id: leftPid } : {}),
      ...(rightPid !== undefined ? { right_polity_id: rightPid } : {}),
    };
  }
  return out;
}

/**
 * Stitch closed outer perimeter rings grouped by `polity_id` in PURE_TERRITORY mode,
 * discarding internal sub-face seams while preserving exclaves as separate rings.
 */
export function extractPolityOuterPerimeterRings(
  snapshot: MapSnapshot,
): Array<{ polity_id: string; rings: Position[][] }> {
  const faceById = new Map(snapshot.territories.features.map((f) => [f.properties.face_id, f.properties]));
  const arcsByPolity = new Map<string, Position[][]>();

  for (const arc of snapshot.boundaries.features) {
    const l = arc.properties.left_face_id ? faceById.get(arc.properties.left_face_id) : undefined;
    const r = arc.properties.right_face_id ? faceById.get(arc.properties.right_face_id) : undefined;
    const lPid = l?.zone_semantics === "POLITY_TERRITORY" ? l.polity_id : undefined;
    const rPid = r?.zone_semantics === "POLITY_TERRITORY" ? r.polity_id : undefined;
    if (lPid && rPid && lPid === rPid) continue;

    if (lPid) {
      const list = arcsByPolity.get(lPid) ?? [];
      list.push(arc.geometry.coordinates);
      arcsByPolity.set(lPid, list);
    }
    if (rPid && rPid !== lPid) {
      const list = arcsByPolity.get(rPid) ?? [];
      list.push(arc.geometry.coordinates);
      arcsByPolity.set(rPid, list);
    }
    if (l?.zone_semantics === "DISPUTED_OVERLAP") {
      const dKey = `disputed:${l.face_id}`;
      const list = arcsByPolity.get(dKey) ?? [];
      list.push(arc.geometry.coordinates);
      arcsByPolity.set(dKey, list);
    }
  }

  const results: Array<{ polity_id: string; rings: Position[][] }> = [];
  for (const [polityId, segments] of arcsByPolity.entries()) {
    const unused = segments.map((s) => s.map((p) => [p[0] ?? 0, p[1] ?? 0] as Position));
    const rings: Position[][] = [];

    while (unused.length > 0) {
      const seed = unused.shift()!;
      if (seed.length < 2) continue;
      const ring: Position[] = seed.slice();
      let guard = 0;
      while (ring.length >= 2 && !pointsEqual(ring[0]!, ring[ring.length - 1]!, 1e-6) && guard < 256) {
        guard += 1;
        const tail = ring[ring.length - 1]!;
        let matchIdx = -1;
        let reverseMatch = false;
        for (let i = 0; i < unused.length; i++) {
          const cand = unused[i]!;
          if (cand.length < 2) continue;
          if (pointsEqual(tail, cand[0]!, 1e-6)) {
            matchIdx = i;
            reverseMatch = false;
            break;
          }
          if (pointsEqual(tail, cand[cand.length - 1]!, 1e-6)) {
            matchIdx = i;
            reverseMatch = true;
            break;
          }
        }
        if (matchIdx < 0) break;
        const picked = unused.splice(matchIdx, 1)[0]!;
        const ordered = reverseMatch ? picked.slice().reverse() : picked;
        for (let k = 1; k < ordered.length; k++) ring.push(ordered[k]!);
      }
      if (ring.length >= 4 && pointsEqual(ring[0]!, ring[ring.length - 1]!, 1e-5)) {
        rings.push(normalizeRingWinding(ring, true));
      }
    }

    if (rings.length > 0) {
      results.push({ polity_id: polityId, rings });
    }
  }
  return results;
}

function pointInTriangle(p: Position, a: Position, b: Position, c: Position): boolean {
  const cross = (o: Position, u: Position, v: Position): number =>
    ((u[0] ?? 0) - (o[0] ?? 0)) * ((v[1] ?? 0) - (o[1] ?? 0))
    - ((u[1] ?? 0) - (o[1] ?? 0)) * ((v[0] ?? 0) - (o[0] ?? 0));
  const c1 = cross(a, b, p);
  const c2 = cross(b, c, p);
  const c3 = cross(c, a, p);
  return c1 >= -1e-10 && c2 >= -1e-10 && c3 >= -1e-10;
}

/**
 * Ear-clipping triangulation of a simple closed 2D ring for arbitrary concave polygons.
 */
export function triangulatePolygonRing(ring: readonly Position[]): Array<[Position, Position, Position]> {
  const ccw = normalizeRingWinding(ring, true);
  const verts: Position[] = [];
  for (let i = 0; i < ccw.length - 1; i++) {
    const pt = ccw[i]!;
    if (verts.length === 0 || !pointsEqual(verts[verts.length - 1]!, pt, 1e-7)) {
      verts.push(pt);
    }
  }
  if (verts.length < 3) return [];
  const triangles: Array<[Position, Position, Position]> = [];
  const remaining = verts.slice();
  let guard = 0;
  const maxIter = remaining.length * remaining.length + 20;

  while (remaining.length > 3 && guard < maxIter) {
    guard += 1;
    let earFound = false;
    const len = remaining.length;
    for (let i = 0; i < len; i++) {
      const a = remaining[(i + len - 1) % len]!;
      const b = remaining[i]!;
      const c = remaining[(i + 1) % len]!;
      const cross = ((b[0] ?? 0) - (a[0] ?? 0)) * ((c[1] ?? 0) - (a[1] ?? 0))
        - ((b[1] ?? 0) - (a[1] ?? 0)) * ((c[0] ?? 0) - (a[0] ?? 0));
      if (cross <= 1e-11) continue;

      let containsAny = false;
      for (let j = 0; j < len; j++) {
        if (j === (i + len - 1) % len || j === i || j === (i + 1) % len) continue;
        if (pointInTriangle(remaining[j]!, a, b, c)) {
          containsAny = true;
          break;
        }
      }
      if (!containsAny) {
        triangles.push([a, b, c]);
        remaining.splice(i, 1);
        earFound = true;
        break;
      }
    }
    if (!earFound) break;
  }
  if (remaining.length === 3) {
    triangles.push([remaining[0]!, remaining[1]!, remaining[2]!]);
  }
  return triangles;
}
