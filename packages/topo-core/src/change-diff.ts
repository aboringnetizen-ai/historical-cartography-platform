import type { MapChangeDiffRequest, MapChangeDiffResult, MapSnapshot, SpatialChangeSet } from "@historical-cartography/shared-schema";
import type { Pool, PoolClient } from "pg";
import { readMapChangeDraft } from "./draft-units.ts";
import { readMapSnapshot } from "./snapshot.ts";

type Face = MapSnapshot["territories"]["features"][number];

function sameFace(a: Face, b: Face): boolean {
  return a.properties.polity_id === b.properties.polity_id
    && a.properties.control_score === b.properties.control_score
    && a.properties.zone_semantics === b.properties.zone_semantics
    && JSON.stringify(a.geometry.coordinates) === JSON.stringify(b.geometry.coordinates);
}

async function renderDiff(client: PoolClient, request: MapChangeDiffRequest): Promise<MapChangeDiffResult> {
  const result = await client.query<{ base_revision_id: string; changeset: SpatialChangeSet; review_id: string | null }>(`
    SELECT b.base_revision_id,
      cartography.read_open_changeset(cs.changeset_id, cs.request_sha256)->'changeset' AS changeset,
      submitted.review_id
    FROM cartography.spatial_changesets AS cs
    JOIN cartography.change_branches AS b USING (epoch_id, branch_name)
    LEFT JOIN cartography.map_review_submissions AS submitted
      ON submitted.changeset_id = cs.changeset_id AND submitted.revision_id = $2 AND submitted.invalidated_at IS NULL
    WHERE cs.changeset_id = $1
  `, [request.changeset_id, request.expected_revision_id]);
  const base = result.rows[0];
  if (!base) return { status: "DRAFT_NOT_FOUND" };

  const current = await readMapChangeDraft(client, request.changeset_id);
  if (current?.revision_id !== request.expected_revision_id.toLowerCase()) return { status: "DRAFT_CHANGED" };
  if (current.revision_id === base.base_revision_id) return { status: "NO_CHANGES" };

  const before = await readMapSnapshot(client, { revision_id: base.base_revision_id, historical_jdn: request.historical_jdn });
  const after = await readMapSnapshot(client, { revision_id: current.revision_id, historical_jdn: request.historical_jdn });
  if (!before || !after) return { status: "OUTSIDE_EPOCH" };

  const beforeById = new Map(before.territories.features.map((face) => [face.properties.face_id, face]));
  const changed = new Set<string>();
  for (const feature of after.territories.features) {
    const id = feature.properties.face_id;
    const prior = beforeById.get(id);
    if (!prior || !sameFace(prior, feature)) changed.add(id);
    beforeById.delete(id);
  }
  for (const removed of beforeById.keys()) changed.add(removed);
  if (!changed.size) return { status: "NO_CHANGES" };

  const affectedArcIds = after.boundaries.features
    .filter(({ properties: { left_face_id, right_face_id } }) =>
      (left_face_id !== null && changed.has(left_face_id)) || (right_face_id !== null && changed.has(right_face_id)))
    .map(({ properties }) => properties.arc_id);
  const changeset = {
    ...base.changeset,
    status: base.review_id ? "PENDING_HUMAN_REVIEW" as const : base.changeset.status,
    operations_log: current.operations.map((operation) => ({ ...operation })),
  };
  return {
    status: "READY",
    changed_face_ids: [...changed].sort(),
    ...(base.review_id ? { review_id: base.review_id } : {}),
    diff: {
      changeset, summary_zh: `${changed.size} 个拓扑面存在变化，关联 ${affectedArcIds.length} 条边界。`,
      before_snapshot: before, after_snapshot: after,
      affected_arc_ids: affectedArcIds, affected_toponym_ids: [],
    },
  };
}

export async function readMapChangeDiff(pool: Pool, request: MapChangeDiffRequest): Promise<MapChangeDiffResult> {
  if (!Number.isFinite(request.historical_jdn)) throw new RangeError("historical_jdn must be finite");
  const client = await pool.connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    return await renderDiff(client, request);
  } finally {
    let discardClient = false;
    try {
      await client.query("ROLLBACK");
    } catch {
      discardClient = true;
    }
    client.release(discardClient);
  }
}
