import type {
  EpochRange,
  MapBoundaryProperties,
  MapFaceProperties,
  MapSnapshot,
  SharedBoundaryArc,
  TerritorialFace,
} from "@historical-cartography/shared-schema";
import type { Feature, LineString, Polygon, Position } from "geojson";

function pointsEqual(a: Position, b: Position): boolean {
  return Math.abs((a[0] ?? 0) - (b[0] ?? 0)) < 1e-9 && Math.abs((a[1] ?? 0) - (b[1] ?? 0)) < 1e-9;
}

/**
 * Derive a tension-bounded smooth curve without mutating `canonical_geometry`.
 * Start and end nodes remain locked so shared arcs stay zero-gap watertight.
 */
export function deriveBoundedSplineGeometry(
  canonical: LineString,
  tension = 0.55,
): LineString {
  const pts = canonical.coordinates;
  if (pts.length <= 2) {
    return { type: "LineString", coordinates: pts.map((p) => [p[0] ?? 0, p[1] ?? 0]) };
  }
  const out: Position[] = [];
  const first = pts[0];
  if (!first) return { type: "LineString", coordinates: [] };
  out.push([first[0] ?? 0, first[1] ?? 0]);

  const alpha = Math.max(0.05, Math.min(0.45, (1 - tension) * 0.45));
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)] ?? first;
    const p1 = pts[i] ?? first;
    const p2 = pts[i + 1] ?? p1;
    const p3 = pts[Math.min(pts.length - 1, i + 2)] ?? p2;

    if (i > 0) {
      out.push([p1[0] ?? 0, p1[1] ?? 0]);
    }
    for (const t of [0.333, 0.667]) {
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
  const last = pts[pts.length - 1] ?? first;
  out.push([last[0] ?? 0, last[1] ?? 0]);
  return { type: "LineString", coordinates: out };
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
  for (const arc of arcs) {
    arcById.set(arc.arc_id, arc);
  }

  const faceFeatures: Array<Feature<Polygon, MapFaceProperties>> = [];
  for (const face of faces) {
    const ring: Position[] = [];
    let currentEnd: Position | undefined;

    for (let idx = 0; idx < face.boundary_arc_ids.length; idx++) {
      const arcId = face.boundary_arc_ids[idx];
      if (!arcId) continue;
      const arc = arcById.get(arcId);
      if (!arc) {
        throw new Error(`Missing shared arc ${arcId} for face ${face.face_id}`);
      }
      const geom = useRenderedSpline && arc.rendered_spline_geometry
        ? arc.rendered_spline_geometry
        : arc.canonical_geometry;
      const coords = geom.coordinates;
      if (coords.length < 2) continue;

      const firstPt = coords[0];
      const lastPt = coords[coords.length - 1];
      if (!firstPt || !lastPt) continue;

      let ordered: Position[];
      if (idx === 0) {
        const nextArcId = face.boundary_arc_ids[1];
        const nextArc = nextArcId ? arcById.get(nextArcId) : undefined;
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
        ordered = forwardConnects || !nextGeom
          ? coords.slice()
          : coords.slice().reverse();
      } else if (currentEnd && pointsEqual(currentEnd, firstPt)) {
        ordered = coords.slice();
      } else if (currentEnd && pointsEqual(currentEnd, lastPt)) {
        ordered = coords.slice().reverse();
      } else {
        throw new Error(
          `Topology gap detected in face ${face.face_id} before arc ${arc.arc_id}`,
        );
      }

      for (let p = idx === 0 ? 0 : 1; p < ordered.length; p++) {
        const pt = ordered[p];
        if (pt) ring.push([pt[0] ?? 0, pt[1] ?? 0]);
      }
      currentEnd = ring[ring.length - 1];
    }

    const ringStart = ring[0];
    const ringEnd = ring[ring.length - 1];
    if (!ringStart || !ringEnd || !pointsEqual(ringStart, ringEnd)) {
      throw new Error(`Face ${face.face_id} boundary ring did not close cleanly`);
    }

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
      const hRing = hGeom.coordinates.map((p) => [p[0] ?? 0, p[1] ?? 0] as Position).reverse();
      if (hRing.length >= 4) {
        holeRings.push(hRing);
      }
    }

    faceFeatures.push({
      type: "Feature",
      id: face.face_id,
      geometry: {
        type: "Polygon",
        coordinates: [ring, ...holeRings],
      },
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
      geometry: {
        type: "LineString",
        coordinates: geom.coordinates.map((p) => [p[0] ?? 0, p[1] ?? 0]),
      },
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
    territories: {
      type: "FeatureCollection",
      features: faceFeatures,
    },
    boundaries: {
      type: "FeatureCollection",
      features: boundaryFeatures,
    },
  };
}
