import type { LineString, Position } from "geojson";
import type { Pool } from "pg";
import type { BoundarySmoothnessProfile, MapSnapshotRequest } from "@historical-cartography/shared-schema";

export interface ArcSplineRequest extends MapSnapshotRequest {
  arc_id: string;
  profile: Pick<BoundarySmoothnessProfile, "simplify_area_ratio" | "spline_tension" | "max_hausdorff_deviation_km">;
  viewport: { west: number; south: number; east: number; north: number };
}

export type ArcSplinePreview =
  | { status: "NATURAL_REFERENCE"; canonical_geometry: LineString; rendered_spline_geometry: LineString }
  | {
    status: "CANDIDATE";
    canonical_geometry: LineString;
    rendered_spline_geometry: LineString;
    measured_max_deviation_km: number;
    deviation_limit_km: number;
  }
  | {
    status: "REJECTED";
    canonical_geometry: LineString;
    reason: "INVALID_CURVE" | "DEVIATION_LIMIT";
    measured_max_deviation_km: number;
    deviation_limit_km: number;
  };

type Point2D = [number, number];
const SAMPLES_PER_SEGMENT = 8;

function isPoint2D(point: Position): point is Point2D {
  return point.length === 2 && point.every(Number.isFinite);
}

function cardinalSegment(before: number, start: number, end: number, after: number, t: number, scale: number): number {
  const tSquared = t * t;
  const tCubed = tSquared * t;
  return (2 * tCubed - 3 * tSquared + 1) * start
    + (tCubed - 2 * tSquared + t) * (end - before) * scale
    + (-2 * tCubed + 3 * tSquared) * end
    + (tCubed - tSquared) * (after - start) * scale;
}

function interpolate(line: LineString, tension: number): LineString {
  const points = line.coordinates;
  const first = points[0];
  const last = points.at(-1);
  if (!first || !last || !isPoint2D(first) || !isPoint2D(last) || points.length < 2 || !points.every(isPoint2D)) {
    throw new RangeError("A spline requires at least two finite 2D points");
  }
  const closed = first[0] === last[0] && first[1] === last[1];
  const scale = (1 - tension) / 2;
  const coordinates: Position[] = [first];
  const initialPrevious = (closed ? points.at(-2) : first) ?? first;
  const finalNext = (closed ? points[1] : last) ?? last;
  let start = first;
  for (const [index, end] of points.slice(1).entries()) {
    const before = points[index - 1] ?? initialPrevious;
    const after = points[index + 2] ?? finalNext;
    for (let sample = 1; sample < SAMPLES_PER_SEGMENT; sample++) {
      const t = sample / SAMPLES_PER_SEGMENT;
      coordinates.push([
        cardinalSegment(before[0], start[0], end[0], after[0], t, scale),
        cardinalSegment(before[1], start[1], end[1], after[1], t, scale),
      ]);
    }
    coordinates.push(end);
    start = end;
  }
  return { type: "LineString", coordinates };
}

export async function deriveSplinePreview(
  pool: Pool,
  canonical: LineString,
  request: ArcSplineRequest,
): Promise<ArcSplinePreview> {
  const { profile, viewport } = request;
  const { west, south, east, north } = viewport;
  const width = east - west;
  const { simplify_area_ratio, spline_tension, max_hausdorff_deviation_km } = profile;
  if (![west, south, east, north].every(Number.isFinite)
      || west < -180 || east > 180 || south < -90 || north > 90 || north <= south || width <= 0 || width > 180) {
    throw new RangeError("Provide a finite WGS84 viewport spanning at most 180 degrees of longitude");
  }
  if (![simplify_area_ratio, spline_tension, max_hausdorff_deviation_km].every(Number.isFinite)
      || simplify_area_ratio < 0 || simplify_area_ratio > 1
      || spline_tension < 0 || spline_tension > 1 || max_hausdorff_deviation_km <= 0) {
    throw new RangeError("Invalid simplification ratio, spline tension or maximum deviation");
  }
  const canonicalJson = JSON.stringify(canonical);
  const simplified = await pool.query<{ geometry: LineString | null }>(
    "SELECT ST_AsGeoJSON(ST_SimplifyVW(ST_GeomFromGeoJSON($1::jsonb), $2), 15)::jsonb AS geometry",
    [canonicalJson, width * (north - south) * simplify_area_ratio],
  );
  const simplifiedCurve = simplified.rows[0]?.geometry;
  const [firstPoint] = canonical.coordinates;
  const lastPoint = canonical.coordinates.at(-1);
  if (simplifiedCurve && firstPoint && lastPoint && simplifiedCurve.coordinates.length >= 2) {
    // GeoJSON serialization of the simplifier may round coordinates. Keep the
    // authoritative native endpoints so PostGIS can check the same arc later.
    simplifiedCurve.coordinates[0] = firstPoint;
    simplifiedCurve.coordinates[simplifiedCurve.coordinates.length - 1] = lastPoint;
  }
  const candidate = interpolate(simplifiedCurve ?? canonical, spline_tension);
  const centerLatitude = (south + north) / 2;
  const localProjection = `+proj=aeqd +lat_0=${centerLatitude} +lon_0=${(west + east) / 2} +datum=WGS84 +units=m +no_defs`;
  const { rows } = await pool.query<{
    valid: boolean; in_offset_band: boolean; measured_max_deviation_km: number; deviation_limit_km: number;
  }>(`
    WITH source AS (
      SELECT ST_GeomFromGeoJSON($1::jsonb) AS canonical, ST_GeomFromGeoJSON($2::jsonb) AS candidate,
        least($3::double precision, 25, 0.008 * ST_Distance(
          ST_SetSRID(ST_MakePoint($4, $6), 4326)::geography,
          ST_SetSRID(ST_MakePoint($5, $6), 4326)::geography
        ) / 1000) AS limit_km
    ), projected AS (
      SELECT *, ST_Transform(canonical, $7::text) AS canonical_m, ST_Transform(candidate, $7::text) AS candidate_m
      FROM source
    )
    SELECT ST_IsSimple(candidate) AND ST_IsValid(candidate)
        AND ST_CoveredBy(candidate, ST_MakeEnvelope(-180, -90, 180, 90, 4326))
        AND ST_Equals(ST_StartPoint(candidate), ST_StartPoint(canonical))
        AND ST_Equals(ST_EndPoint(candidate), ST_EndPoint(canonical)) AS valid,
      ST_CoveredBy(candidate_m, ST_Buffer(canonical_m, limit_km * 1000))
        AND ST_CoveredBy(canonical_m, ST_Buffer(candidate_m, limit_km * 1000)) AS in_offset_band,
      ST_HausdorffDistance(canonical_m, candidate_m, 0.125) / 1000 AS measured_max_deviation_km,
      limit_km AS deviation_limit_km
    FROM projected
  `, [canonicalJson, JSON.stringify(candidate), max_hausdorff_deviation_km, west, east, centerLatitude, localProjection]);
  const measurement = rows[0];
  if (!measurement) throw new Error("Spline measurement returned no result");
  const { measured_max_deviation_km, deviation_limit_km } = measurement;
  if (!measurement.valid || !measurement.in_offset_band || measured_max_deviation_km > deviation_limit_km) {
    return {
      status: "REJECTED",
      canonical_geometry: canonical,
      reason: measurement.valid ? "DEVIATION_LIMIT" : "INVALID_CURVE",
      measured_max_deviation_km,
      deviation_limit_km,
    };
  }
  return {
    status: "CANDIDATE",
    canonical_geometry: canonical,
    rendered_spline_geometry: candidate,
    measured_max_deviation_km,
    deviation_limit_km,
  };
}
