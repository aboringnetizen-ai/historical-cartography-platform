import { randomUUID } from "node:crypto";
import type { LineString, Point } from "geojson";
import type { Pool } from "pg";
import type {
  EpochRange,
  MapFaceProperties,
  MapSnapshotRequest,
} from "@historical-cartography/shared-schema";
import { deriveSplinePreview } from "./spline-preview.ts";
import type { ArcSplinePreview, ArcSplineRequest } from "./spline-preview.ts";
import { checkSplineCandidate } from "./smoothing-gate.ts";
import type { ArcSmoothingCheck, ArcSmoothingCheckRequest } from "./smoothing-gate.ts";

export { migrateTopology } from "./migrate.ts";
export { readMapChangeDiff } from "./change-diff.ts";
export { readMapSnapshot } from "./snapshot.ts";
export { openMapChangeSet, recheckMapChangeEvidence } from "./changesets.ts";
export { submitMapChangeForReview } from "./review-submission.ts";
export { readMapChangeDraft, reassignBaseUnits, registerDraftFaceLock, rollbackDraftReassignment } from "./draft-units.ts";
export type { ArcSplinePreview, ArcSplineRequest } from "./spline-preview.ts";
export { registerLandmarkInventory } from "./smoothing-gate.ts";
export type { ArcSmoothingCheck, ArcSmoothingCheckRequest, LandmarkAnchor } from "./smoothing-gate.ts";

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

export async function previewSharedArcSmoothing(pool: Pool, request: ArcSplineRequest): Promise<ArcSplinePreview | null> {
  const edgeId = nativeEdgeId(request);
  if (!edgeId) return null;
  if (!Number.isFinite(request.historical_jdn)) throw new RangeError("historical_jdn must be finite");
  const { rows } = await pool.query<{ arc: { geometry: LineString; paleo: boolean } | null }>(
    "SELECT cartography.read_native_arc($1, $2, $3) AS arc",
    [request.revision_id, request.historical_jdn, edgeId],
  );
  const arc = rows[0]?.arc;
  if (!arc) return null;
  if (arc.paleo) {
    return {
      status: "NATURAL_REFERENCE",
      canonical_geometry: arc.geometry,
      rendered_spline_geometry: arc.geometry,
    };
  }
  return deriveSplinePreview(pool, arc.geometry, request);
}

export async function checkSharedArcSmoothing(pool: Pool, request: ArcSmoothingCheckRequest): Promise<ArcSmoothingCheck | null> {
  const edgeId = nativeEdgeId(request);
  if (!edgeId) return null;
  const preview = await previewSharedArcSmoothing(pool, request);
  return preview ? checkSplineCandidate(pool, edgeId, preview, request) : null;
}

function nativeEdgeId(request: ArcSplineRequest): string | undefined {
  const prefix = `${request.revision_id.toLowerCase()}:arc:`;
  if (!request.arc_id.startsWith(prefix)) return undefined;
  const id = request.arc_id.slice(prefix.length);
  return /^[1-9]\d{0,18}$/.test(id) && BigInt(id) <= 9_223_372_036_854_775_807n ? id : undefined;
}
