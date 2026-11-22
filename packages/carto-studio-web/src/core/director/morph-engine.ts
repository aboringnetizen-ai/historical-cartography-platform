import type {
  DirectorKeyframe,
  MapBoundaryProperties,
  MapFaceProperties,
  MapSnapshot,
} from "@historical-cartography/shared-schema";
import type { Feature, LineString, Polygon, Position } from "geojson";
import { normalizeRingWinding, pointsEqual } from "../data/topology-builder.ts";

export interface TopologyTransitionPlan {
  is_homeomorphic: boolean;
  mode: "STREAMLINE_ARC_MORPH" | NonNullable<DirectorKeyframe["topology_change_fallback"]>;
  shared_arc_ids: string[];
  added_or_removed_arcs: string[];
  reason_zh: string;
}

/**
 * Equidistant arc-length resampling along a polyline for spiderweb-free morphing.
 */
export function resampleLineString(coords: readonly Position[], targetCount: number): Position[] {
  if (coords.length === 0) return [];
  if (coords.length === 1 || targetCount <= 1) return [coords[0]!];

  const cum: number[] = [0];
  let total = 0;
  for (let i = 1; i < coords.length; i++) {
    const a = coords[i - 1]!;
    const b = coords[i]!;
    total += Math.hypot((b[0] ?? 0) - (a[0] ?? 0), (b[1] ?? 0) - (a[1] ?? 0));
    cum.push(total);
  }
  if (total <= 1e-12) {
    return Array.from({ length: targetCount }, () => [coords[0]![0] ?? 0, coords[0]![1] ?? 0]);
  }

  const out: Position[] = [];
  for (let k = 0; k < targetCount; k++) {
    const targetDist = (k / (targetCount - 1)) * total;
    let segIdx = 0;
    while (segIdx < cum.length - 2 && cum[segIdx + 1]! < targetDist) {
      segIdx += 1;
    }
    const d0 = cum[segIdx]!;
    const d1 = cum[segIdx + 1]!;
    const segSpan = Math.max(1e-12, d1 - d0);
    const ratio = Math.max(0, Math.min(1, (targetDist - d0) / segSpan));
    const p0 = coords[segIdx]!;
    const p1 = coords[segIdx + 1]!;
    out.push([
      Number((((p0[0] ?? 0) + ((p1[0] ?? 0) - (p0[0] ?? 0)) * ratio)).toFixed(5)),
      Number((((p0[1] ?? 0) + ((p1[1] ?? 0) - (p0[1] ?? 0)) * ratio)).toFixed(5)),
    ]);
  }
  return out;
}

/**
 * Two-stage topology transition classifier (P5 / SPEC 8.2):
 * Checks arc_id identity AND endpoint nodes AND left/right face connectivity + face_id set.
 */
export function classifyTopologyTransition(
  fromSnapshot: MapSnapshot,
  toSnapshot: MapSnapshot,
  preferredFallback: NonNullable<DirectorKeyframe["topology_change_fallback"]> = "OCCUPATION_RIPPLE",
): TopologyTransitionPlan {
  const fromArcMap = new Map(fromSnapshot.boundaries.features.map((f) => [f.properties.arc_id, f.properties]));
  const toArcMap = new Map(toSnapshot.boundaries.features.map((f) => [f.properties.arc_id, f.properties]));

  const shared: string[] = [];
  const changed: string[] = [];
  for (const [id, fromProps] of fromArcMap.entries()) {
    const toProps = toArcMap.get(id);
    if (!toProps) {
      changed.push(id);
      continue;
    }
    const sameNodes = fromProps.start_node_id === toProps.start_node_id && fromProps.end_node_id === toProps.end_node_id;
    const sameFaces = fromProps.left_face_id === toProps.left_face_id && fromProps.right_face_id === toProps.right_face_id;
    if (sameNodes && sameFaces) {
      shared.push(id);
    } else {
      changed.push(id);
    }
  }
  for (const id of toArcMap.keys()) {
    if (!fromArcMap.has(id)) changed.push(id);
  }

  const fromFaceIds = new Set(fromSnapshot.territories.features.map((f) => f.properties.face_id));
  const toFaceIds = new Set(toSnapshot.territories.features.map((f) => f.properties.face_id));
  const faceCountChanged = fromFaceIds.size !== toFaceIds.size || Array.from(fromFaceIds).some((id) => !toFaceIds.has(id));

  if (!faceCountChanged && changed.length === 0) {
    return {
      is_homeomorphic: true,
      mode: "STREAMLINE_ARC_MORPH",
      shared_arc_ids: shared,
      added_or_removed_arcs: [],
      reason_zh: "共享弧段端点节点与左右面连通关系不变，启用等距重采样顶点流式插值。",
    };
  }

  return {
    is_homeomorphic: false,
    mode: preferredFallback,
    shared_arc_ids: shared,
    added_or_removed_arcs: changed,
    reason_zh: `检测到跨纪元拓扑连通突变（${changed.length} 条弧段增减/重连），自动切换为 ${preferredFallback} 防穿帮过渡。`,
  };
}

/**
 * Interpolate fractional snapshot between `fromSnapshot` and `toSnapshot` at `progress` ∈ [0, 1].
 * Preserves strict zero-gap shared-arc watertightness when homeomorphic by interpolating arcs
 * once and reconstructing all polygon rings from those shared interpolated arcs.
 */
export function interpolateMorphSnapshot(
  fromSnapshot: MapSnapshot,
  toSnapshot: MapSnapshot,
  progress: number,
  plan: TopologyTransitionPlan,
): MapSnapshot {
  const t = Math.max(0, Math.min(1, progress));
  if (!plan.is_homeomorphic || t >= 0.999) return toSnapshot;
  if (t <= 0.001) return fromSnapshot;

  const fromArcs = new Map(fromSnapshot.boundaries.features.map((f) => [f.properties.arc_id, f]));
  const toArcs = new Map(toSnapshot.boundaries.features.map((f) => [f.properties.arc_id, f]));

  const morphedArcCoords = new Map<string, Position[]>();
  const morphedBoundaries: Array<Feature<LineString, MapBoundaryProperties>> = [];

  for (const [arcId, toFeat] of toArcs.entries()) {
    const fromFeat = fromArcs.get(arcId);
    let coords: Position[];
    if (fromFeat) {
      const n = Math.max(fromFeat.geometry.coordinates.length, toFeat.geometry.coordinates.length, 16);
      const aPts = resampleLineString(fromFeat.geometry.coordinates, n);
      const bPts = resampleLineString(toFeat.geometry.coordinates, n);
      coords = aPts.map((pa, idx) => {
        const pb = bPts[idx]!;
        return [
          Number((((pa[0] ?? 0) + ((pb[0] ?? 0) - (pa[0] ?? 0)) * t)).toFixed(5)),
          Number((((pa[1] ?? 0) + ((pb[1] ?? 0) - (pa[1] ?? 0)) * t)).toFixed(5)),
        ];
      });
    } else {
      coords = toFeat.geometry.coordinates;
    }
    morphedArcCoords.set(arcId, coords);
    morphedBoundaries.push({
      type: "Feature",
      id: arcId,
      geometry: { type: "LineString", coordinates: coords },
      properties: { ...toFeat.properties },
    });
  }

  const fromFaces = new Map(fromSnapshot.territories.features.map((f) => [f.properties.face_id, f]));
  const morphedTerritories: Array<Feature<Polygon, MapFaceProperties>> = toSnapshot.territories.features.map((toFace) => {
    const arcIds = toFace.properties.boundary_arc_ids;
    const ring: Position[] = [];
    let currentEnd: Position | undefined;
    let failedStitch = false;

    for (let idx = 0; idx < arcIds.length; idx++) {
      const aid = arcIds[idx]!;
      const pts = morphedArcCoords.get(aid);
      if (!pts || pts.length < 2) {
        failedStitch = true;
        break;
      }
      let ordered: Position[];
      if (idx === 0) {
        const nextPts = arcIds[1] ? morphedArcCoords.get(arcIds[1]!) : undefined;
        const lastPt = pts[pts.length - 1]!;
        const forwardConnects = Boolean(
          nextPts && (pointsEqual(lastPt, nextPts[0]!, 1e-5) || pointsEqual(lastPt, nextPts[nextPts.length - 1]!, 1e-5)),
        );
        ordered = forwardConnects || !nextPts ? pts : pts.slice().reverse();
      } else if (currentEnd && pointsEqual(currentEnd, pts[0]!, 1e-5)) {
        ordered = pts;
      } else if (currentEnd && pointsEqual(currentEnd, pts[pts.length - 1]!, 1e-5)) {
        ordered = pts.slice().reverse();
      } else {
        failedStitch = true;
        break;
      }
      for (let p = idx === 0 ? 0 : 1; p < ordered.length; p++) {
        ring.push(ordered[p]!);
      }
      currentEnd = ring[ring.length - 1];
    }

    const fromScore = fromFaces.get(toFace.properties.face_id)?.properties.control_score ?? toFace.properties.control_score;
    const score = Math.round(fromScore + (toFace.properties.control_score - fromScore) * t);

    return {
      type: "Feature",
      id: toFace.id,
      geometry: failedStitch || ring.length < 4
        ? toFace.geometry
        : { type: "Polygon", coordinates: [normalizeRingWinding(ring, true)] },
      properties: { ...toFace.properties, control_score: score },
    };
  });

  return {
    epoch: toSnapshot.epoch,
    revision_id: `${toSnapshot.revision_id}@morph-${Math.round(t * 100)}`,
    data_status: toSnapshot.data_status,
    territories: { type: "FeatureCollection", features: morphedTerritories },
    boundaries: { type: "FeatureCollection", features: morphedBoundaries },
  };
}
