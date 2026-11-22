import type { MapSnapshot, MapSnapshotRequest } from "@historical-cartography/shared-schema";
import type { Pool } from "pg";

export async function readMapSnapshot(pool: Pick<Pool, "query">, request: MapSnapshotRequest): Promise<MapSnapshot | null> {
  if (!Number.isFinite(request.historical_jdn)) {
    throw new RangeError("historical_jdn must be finite");
  }
  const { rows } = await pool.query<{ snapshot: MapSnapshot | null; paleo_features: Record<string, string> }>(
    `SELECT cartography.read_map_snapshot($1::uuid, $2) AS snapshot,
       coalesce(jsonb_object_agg($1::uuid::text || ':arc:' || edge_id, feature_id), '{}'::jsonb) AS paleo_features
     FROM cartography.paleo_arc_bindings WHERE revision_id = $1`,
    [request.revision_id, request.historical_jdn],
  );
  const row = rows[0];
  if (!row?.snapshot) return null;
  for (const { properties } of row.snapshot.boundaries.features) {
    const featureId = row.paleo_features[properties.arc_id];
    if (featureId !== undefined) properties.snapped_paleo_feature_id = featureId;
  }
  return row.snapshot;
}
