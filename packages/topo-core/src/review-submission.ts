import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import type {
  EventEvidenceReader, SubmitMapChangeReviewRequest, SubmitMapChangeReviewResult,
} from "@historical-cartography/shared-schema";
import { recheckMapChangeEvidence } from "./changesets.ts";

async function invalidateReview(client: PoolClient, changeSetId: string, revisionId: string) {
  await client.query(`
    UPDATE cartography.map_review_submissions SET invalidated_at = transaction_timestamp()
    WHERE changeset_id = $1 AND revision_id = $2 AND invalidated_at IS NULL
  `, [changeSetId, revisionId]);
}

async function checkAndRegister(
  client: PoolClient, evidence: EventEvidenceReader, request: SubmitMapChangeReviewRequest,
): Promise<SubmitMapChangeReviewResult> {
  const changeSetId = request.changeset_id.toLowerCase();
  const expectedRevisionId = request.expected_revision_id.toLowerCase();
  const locked = await client.query<{ epoch_id: string }>(
    "SELECT epoch_id FROM cartography.spatial_changesets WHERE changeset_id = $1 FOR UPDATE", [changeSetId],
  );
  const changeSet = locked.rows[0];
  if (!changeSet) return { status: "BLOCKED", reason: "DRAFT_NOT_FOUND", issues: [] };

  // This is a separate statement so READ COMMITTED sees head updates made by
  // any editor whose ChangeSet row lock we waited for.
  const head = await client.query<{ active_revision_id: string; has_active_operation: boolean }>(`
    SELECT coalesce(h.revision_id, b.base_revision_id) AS active_revision_id,
      EXISTS (
        SELECT 1 FROM cartography.unit_reassignments AS op
        WHERE op.changeset_id = cs.changeset_id AND op.revision_id = h.revision_id AND op.rolled_back_at IS NULL
      ) AS has_active_operation
    FROM cartography.spatial_changesets AS cs
    JOIN cartography.change_branches AS b USING (epoch_id, branch_name)
    LEFT JOIN cartography.draft_heads AS h USING (changeset_id)
    WHERE cs.changeset_id = $1
  `, [changeSetId]);
  const draft = head.rows[0];
  if (draft?.active_revision_id !== expectedRevisionId) {
    return { status: "BLOCKED", reason: "DRAFT_CHANGED", issues: [] };
  }
  if (!draft.has_active_operation) return { status: "BLOCKED", reason: "NO_ACTIVE_OPERATION", issues: [] };

  await client.query("SELECT 1 FROM cartography.epochs WHERE epoch_id = $1 FOR SHARE", [changeSet.epoch_id]);
  const faceLocks = await client.query<{ face_id: string }>(`
    SELECT DISTINCT locked.face_id
    FROM cartography.unit_reassignments AS op JOIN cartography.draft_face_locks AS locked
      ON locked.epoch_id = $2 AND locked.face_id = ANY (op.moved_face_ids)
    WHERE op.changeset_id = $1 AND op.rolled_back_at IS NULL ORDER BY locked.face_id
  `, [changeSetId, changeSet.epoch_id]);
  if (faceLocks.rows.length) {
    await invalidateReview(client, changeSetId, expectedRevisionId);
    return {
      status: "BLOCKED", reason: "HUMAN_LOCKED", issues: faceLocks.rows.map(({ face_id }) => ({
        gate: "G4", code: "HUMAN_LOCKED", entity_id: face_id, message: "A human lock now protects this changed unit",
      })),
    };
  }

  const checked = await recheckMapChangeEvidence(client, evidence, changeSetId);
  if (!checked) throw new Error("Locked ChangeSet disappeared during evidence verification");
  if (checked.status === "BLOCKED") {
    await invalidateReview(client, changeSetId, expectedRevisionId);
    return { status: "BLOCKED", reason: "EVIDENCE", issues: checked.issues };
  }

  await client.query(`
    INSERT INTO cartography.map_review_submissions (review_id, changeset_id, revision_id, bound_events)
    VALUES ($1, $2, $3, $4)
    ON CONFLICT (changeset_id, revision_id) WHERE invalidated_at IS NULL DO NOTHING
  `, [randomUUID(), changeSetId, expectedRevisionId, JSON.stringify(checked.bound_events)]);
  const { rows } = await client.query<{ review_id: string }>(`
    SELECT review_id FROM cartography.map_review_submissions
    WHERE changeset_id = $1 AND revision_id = $2 AND invalidated_at IS NULL
  `, [changeSetId, expectedRevisionId]);
  const reviewId = rows[0]?.review_id;
  if (!reviewId) throw new Error("Current review submission could not be found");
  return {
    status: "SUBMITTED_FOR_REVIEW", review_id: reviewId, changeset_id: changeSetId,
    revision_id: expectedRevisionId, bound_events: checked.bound_events,
  };
}

export async function submitMapChangeForReview(
  pool: Pool, evidence: EventEvidenceReader, request: SubmitMapChangeReviewRequest,
): Promise<SubmitMapChangeReviewResult> {
  const client = await pool.connect();
  let discardClient = false;
  try {
    await client.query("BEGIN ISOLATION LEVEL READ COMMITTED");
    const outcome = await checkAndRegister(client, evidence, request);
    await client.query("COMMIT");
    return outcome;
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {
      discardClient = true;
    }
    throw error;
  } finally {
    client.release(discardClient);
  }
}
