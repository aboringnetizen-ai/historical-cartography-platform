import { createHash, randomUUID } from "node:crypto";
import type { Pool } from "pg";
import type { DraftUnitOperation, MapChangeDraft, ReassignBaseUnitsRequest } from "@historical-cartography/shared-schema";

export async function registerDraftFaceLock(pool: Pool, revisionId: string, faceId: string): Promise<void> {
  await pool.query("SELECT cartography.register_draft_face_lock($1, $2)", [revisionId, faceId]);
}

export async function readMapChangeDraft(pool: Pool, changeSetId: string): Promise<MapChangeDraft | null> {
  const { rows } = await pool.query<MapChangeDraft>(`
    SELECT coalesce(h.revision_id, b.base_revision_id) AS revision_id,
      coalesce((
        SELECT jsonb_agg(cartography.read_unit_reassignment(op.operation_id) ORDER BY op.sequence_no)
        FROM cartography.unit_reassignments AS op WHERE op.changeset_id = cs.changeset_id
      ), '[]'::jsonb) AS operations
    FROM cartography.spatial_changesets AS cs
    JOIN cartography.change_branches AS b USING (epoch_id, branch_name)
    LEFT JOIN cartography.draft_heads AS h USING (changeset_id)
    WHERE cs.changeset_id = $1
  `, [changeSetId]);
  return rows[0] ?? null;
}

export async function reassignBaseUnits(pool: Pool, request: ReassignBaseUnitsRequest): Promise<DraftUnitOperation> {
  const normalized = {
    changeset_id: request.changeset_id.toLowerCase(),
    operation_id: request.operation_id.toLowerCase(),
    expected_revision_id: request.expected_revision_id.toLowerCase(),
    driven_by_event_ids: [...request.driven_by_event_ids].sort(),
    assignments: request.assignments.map(({ face_id, polity_id, control_score }) => ({ face_id, polity_id, control_score }))
      .sort((a, b) => a.face_id < b.face_id ? -1 : a.face_id === b.face_id ? 0 : 1),
  };
  const requestHash = createHash("sha256").update(JSON.stringify(normalized)).digest("hex");
  const { rows } = await pool.query<{ operation: DraftUnitOperation }>(
    "SELECT cartography.reassign_draft_units($1, $2, $3, $4, $5, $6, $7) AS operation",
    [
      normalized.changeset_id, normalized.operation_id, normalized.expected_revision_id, randomUUID(), requestHash,
      JSON.stringify(normalized.assignments), normalized.driven_by_event_ids,
    ],
  );
  if (!rows[0]?.operation) throw new Error("Unit reassignment returned no operation");
  return rows[0].operation;
}

export async function rollbackDraftReassignment(
  pool: Pool, changeSetId: string, operationId: string,
): Promise<DraftUnitOperation> {
  const { rows } = await pool.query<{ operation: DraftUnitOperation }>(
    "SELECT cartography.rollback_draft_reassignment($1, $2) AS operation", [changeSetId, operationId],
  );
  if (!rows[0]?.operation) throw new Error("Unit rollback returned no operation");
  return rows[0].operation;
}
