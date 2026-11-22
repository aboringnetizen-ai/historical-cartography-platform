import { randomUUID } from "node:crypto";
import type { LineString, Point } from "geojson";
import type { Pool } from "pg";
import type {
  EpochRange,
  MapFaceProperties,
  MapSnapshot,
  MapSnapshotRequest,
} from "@historical-cartography/shared-schema";
import { deriveSplinePreview } from "./spline-preview.ts";
import type { ArcSplinePreview, ArcSplineRequest } from "./spline-preview.ts";

export { migrateTopology } from "./migrate.ts";
export type { ArcSplinePreview, ArcSplineRequest } from "./spline-preview.ts";

export interface DraftFaceSeed extends Omit<MapFaceProperties, "boundary_arc_ids"> {
  seed: Point;
}

export interface DraftTopologyInput {
  epoch: EpochRange;
  coverage_boundaries: readonly LineString[];
  internal_boundaries: readonly LineString[];
  faces: readonly DraftFaceSeed[];
  paleo_feature_ids?: readonly string[];
}

export interface PaleoLineReference {
  epoch: EpochRange;
  feature_id: string;
  source_doc_id: string;
  feature_kind: "RIVER" | "COASTLINE" | "LAKE";
  geometry: LineString;
}

export async function registerPaleoReference(pool: Pool, reference: PaleoLineReference): Promise<void> {
  const { epoch } = reference;
  await pool.query("SELECT cartography.register_paleo_reference($1, $2, $3, $4, $5, $6, $7)", [
    epoch.epoch_id, epoch.valid_from_jdn, epoch.valid_to_jdn, reference.feature_id,
    reference.source_doc_id, reference.feature_kind, JSON.stringify(reference.geometry),
  ]);
}

// Import reviewed linework into an immutable draft. Promotion to an official
// branch requires a separate ChangeSet transaction and evidence gates.
export async function createDraftTopologyRevision(pool: Pool, input: DraftTopologyInput): Promise<string> {
  const revisionId = randomUUID();
  await pool.query(
    "SELECT cartography.build_draft_with_paleo($1, $2, $3, $4, $5, $6, $7, $8)",
    [
      revisionId, input.epoch.epoch_id, input.epoch.valid_from_jdn, input.epoch.valid_to_jdn,
      JSON.stringify(input.coverage_boundaries), JSON.stringify(input.internal_boundaries),
      JSON.stringify(input.faces), input.paleo_feature_ids ?? [],
    ],
  );
  return revisionId;
}

export async function readMapSnapshot(pool: Pool, request: MapSnapshotRequest): Promise<MapSnapshot | null> {
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

export async function previewSharedArcSmoothing(pool: Pool, request: ArcSplineRequest): Promise<ArcSplinePreview | null> {
  const snapshot = await readMapSnapshot(pool, request);
  const boundary = snapshot?.boundaries.features.find(({ properties }) => properties.arc_id === request.arc_id);
  if (!boundary) return null;
  if (boundary.properties.snapped_paleo_feature_id !== undefined) {
    return {
      status: "NATURAL_REFERENCE",
      canonical_geometry: boundary.geometry,
      rendered_spline_geometry: boundary.geometry,
    };
  }
  return deriveSplinePreview(pool, boundary.geometry, request);
}
