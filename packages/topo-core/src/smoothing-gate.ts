import type { LineString } from "geojson";
import type { Pool } from "pg";
import type { BoundarySmoothnessProfile, GateIssue, GateResult, HistoricalToponym } from "@historical-cartography/shared-schema";
import type { ArcSplinePreview, ArcSplineRequest } from "./spline-preview.ts";

export type LandmarkAnchor = Pick<HistoricalToponym, "toponym_id" | "coordinates" | "valid_from_jdn" | "valid_to_jdn">;

export interface ArcSmoothingCheckRequest extends ArcSplineRequest {
  viewport_width_px: number;
  profile: ArcSplineRequest["profile"] & Pick<BoundarySmoothnessProfile,
    "target_fractal_dim_range" | "min_micro_turn_angle_deg"
  >;
}

interface CurveTexture {
  measured_fractal_dim: number | null;
  measured_min_micro_turn_angle_deg: number | null;
}

export interface ArcSmoothingCheck {
  gate: GateResult;
  preview: ArcSplinePreview;
  texture: CurveTexture | null;
}

export async function registerLandmarkInventory(
  pool: Pool,
  revisionId: string,
  anchors: readonly LandmarkAnchor[],
): Promise<void> {
  await pool.query("SELECT cartography.register_landmark_inventory($1, $2)", [
    revisionId,
    JSON.stringify(anchors.map(({ toponym_id, coordinates, valid_from_jdn, valid_to_jdn }) =>
      ({ toponym_id, coordinates, valid_from_jdn, valid_to_jdn }))),
  ]);
}

function textureMeasurement(pool: Pool, geom: LineString, request: ArcSmoothingCheckRequest) {
  const { west, south, east, north } = request.viewport;
  const latitude = (south + north) / 2;
  const projection = `+proj=aeqd +lat_0=${latitude} +lon_0=${(west + east) / 2} +datum=WGS84 +units=m +no_defs`;
  return pool.query<CurveTexture>(`
    WITH shape AS (
      SELECT ST_Transform(ST_GeomFromGeoJSON($1::jsonb), $2::text) AS geom,
        5 * ST_Distance(
          ST_SetSRID(ST_MakePoint($3, $5), 4326)::geography,
          ST_SetSRID(ST_MakePoint($4, $5), 4326)::geography
        ) / $6::double precision AS micro_step_m
    ), chord_lengths AS (
      SELECT scale.n, sum(ST_Distance(
        ST_LineInterpolatePoint(geom, (step.i - 1)::double precision / scale.n),
        ST_LineInterpolatePoint(geom, step.i::double precision / scale.n)
      )) AS length
      FROM shape CROSS JOIN (VALUES (4), (8), (16), (32), (64)) AS scale(n)
      CROSS JOIN LATERAL generate_series(1, scale.n) AS step(i)
      GROUP BY scale.n
    ), neighbours AS (
      SELECT p.geom AS vertex, lag(p.geom) OVER arc AS previous, lead(p.geom) OVER arc AS next, micro_step_m
      FROM shape CROSS JOIN LATERAL ST_DumpPoints(shape.geom) AS p
      WINDOW arc AS (ORDER BY p.path)
    ), triangles AS (
      SELECT ST_Distance(vertex, previous) AS a, ST_Distance(vertex, next) AS b,
        ST_Distance(previous, next) AS c, micro_step_m
      FROM neighbours WHERE previous IS NOT NULL AND next IS NOT NULL
    )
    SELECT (
      SELECT 1 + regr_slope(ln(length), ln(n::double precision)) FROM chord_lengths WHERE length > 0
    ) AS measured_fractal_dim, (
      SELECT min(degrees(acos(greatest(-1, least(1, (a*a + b*b - c*c) / nullif(2*a*b, 0))))))
      FROM triangles WHERE a > 0 AND b > 0 AND least(a,b) < micro_step_m
    ) AS measured_min_micro_turn_angle_deg
  `, [JSON.stringify(geom), projection, west, east, latitude, request.viewport_width_px]);
}

export async function checkSplineCandidate(
  pool: Pool,
  edgeId: string,
  preview: ArcSplinePreview,
  request: ArcSmoothingCheckRequest,
): Promise<ArcSmoothingCheck> {
  const [requestedMin, requestedMax] = request.profile.target_fractal_dim_range;
  const [minFractal, maxFractal] = [Math.max(1.04, requestedMin), Math.min(1.22, requestedMax)];
  const minAngle = Math.max(135, request.profile.min_micro_turn_angle_deg);
  if (!Number.isFinite(request.viewport_width_px) || request.viewport_width_px <= 0
      || !Number.isFinite(requestedMin) || !Number.isFinite(requestedMax) || minFractal > maxFractal
      || !Number.isFinite(request.profile.min_micro_turn_angle_deg) || minAngle > 180) {
    throw new RangeError("Invalid viewport width, target fractal interval or micro-turn angle");
  }
  const issues: GateIssue[] = [];
  let texture: CurveTexture | null = null;
  if (preview.status === "REJECTED") {
    issues.push({ gate: "G1.5", code: "INVALID_BOUNDARY_SMOOTHNESS", entity_id: request.arc_id, message: preview.reason });
  } else if (preview.status === "CANDIDATE") {
    const geom = preview.rendered_spline_geometry;
    const [measured, checked] = await Promise.all([
      textureMeasurement(pool, geom, request),
      pool.query<{ topology_error: string | null; anchors_registered: boolean; changed_toponym_ids: string[] }>(
        "SELECT * FROM cartography.check_draft_spline($1, $2, $3)",
        [request.revision_id, edgeId, JSON.stringify(geom)],
      ),
    ]);
    texture = measured.rows[0] ?? null;
    const check = checked.rows[0];
    if (!texture || !check) throw new Error("Missing spline measurement or topology inspection");
    const { measured_fractal_dim: fractal, measured_min_micro_turn_angle_deg: angle } = texture;
    if (fractal === null || fractal < minFractal || fractal > maxFractal) {
      issues.push({
        gate: "G1.5", code: "INVALID_BOUNDARY_SMOOTHNESS", entity_id: request.arc_id,
        message: `Measured fractal dimension ${fractal} is outside [${minFractal}, ${maxFractal}]`,
      });
    }
    if (angle !== null && angle < minAngle) {
      issues.push({
        gate: "G1.5", code: "INVALID_BOUNDARY_SMOOTHNESS", entity_id: request.arc_id,
        message: `Micro-turn angle ${angle}° is below ${minAngle}°`,
      });
    }
    if (check.topology_error) {
      issues.push({ gate: "G1.5", code: "INVALID_TOPOLOGY", entity_id: request.arc_id, message: check.topology_error });
    }
    if (!check.anchors_registered) {
      issues.push({
        gate: "G1.5", code: "INVALID_BOUNDARY_SMOOTHNESS", entity_id: request.arc_id,
        message: "The topology revision has no registered landmark inventory",
      });
    }
    for (const toponymId of check.changed_toponym_ids) {
      issues.push({
        gate: "G1.5", code: "TOPONYM_FACE_CHANGED", entity_id: toponymId,
        message: `Candidate arc ${request.arc_id} changes the landmark's face membership`,
      });
    }
  }
  return { gate: { gate: "G1.5", passed: issues.length === 0, issues }, preview, texture };
}
