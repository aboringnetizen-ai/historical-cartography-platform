import { randomUUID } from "node:crypto";
import type { LineString, Point } from "geojson";
import type { Pool } from "pg";
import type {
  EpochRange,
  MapFaceProperties,
  MapSnapshot,
  MapSnapshotRequest,
} from "@historical-cartography/shared-schema";

export { migrateTopology } from "./migrate.ts";

export interface DraftFaceSeed extends Omit<MapFaceProperties, "boundary_arc_ids"> {
  seed: Point;
}

export interface DraftTopologyInput {
  epoch: EpochRange;
  coverage_boundaries: readonly LineString[];
  internal_boundaries: readonly LineString[];
  faces: readonly DraftFaceSeed[];
}

// Import reviewed linework into an immutable draft. Promotion to an official
// branch requires a separate ChangeSet transaction and evidence gates.
export async function createDraftTopologyRevision(pool: Pool, input: DraftTopologyInput): Promise<string> {
  const revisionId = randomUUID();
  await pool.query(
    "SELECT cartography.build_draft_topology($1, $2, $3, $4, $5, $6, $7)",
    [
      revisionId, input.epoch.epoch_id, input.epoch.valid_from_jdn, input.epoch.valid_to_jdn,
      JSON.stringify(input.coverage_boundaries), JSON.stringify(input.internal_boundaries),
      JSON.stringify(input.faces),
    ],
  );
  return revisionId;
}

export async function readMapSnapshot(pool: Pool, request: MapSnapshotRequest): Promise<MapSnapshot | null> {
  if (!Number.isFinite(request.historical_jdn)) {
    throw new RangeError("historical_jdn must be finite");
  }
  const { rows } = await pool.query<{ snapshot: MapSnapshot | null }>(
    "SELECT cartography.read_map_snapshot($1, $2) AS snapshot",
    [request.revision_id, request.historical_jdn],
  );
  return rows[0]?.snapshot ?? null;
}
