import { createHash } from "node:crypto";
import type { Pool } from "pg";
import type {
  BoundEventRevision, EventEvidenceReader, EventEvidenceResult, EvidenceCitation, GateIssue,
  MapChangeEvidenceCheck, OpenMapChangeSetRequest, OpenMapChangeSetResult,
} from "@historical-cartography/shared-schema";

type Opened = Extract<OpenMapChangeSetResult, { status: "OPENED" }>;
type Verified = Extract<EventEvidenceResult, { status: "VERIFIED" }>;

const tierRank = {
  T1_PRIMARY_AND_LOCAL_ACADEMIC: 3,
  T2_SECONDARY_SCHOLARLY_OR_CURATED: 2,
  T3_GENERAL_ENCYCLOPEDIA: 1,
} as const;

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function nonblank(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function normalizedIdentifier(value: unknown): value is string {
  return nonblank(value) && value.trim() === value;
}

function matchCitation(record: EvidenceCitation, confirmation: EvidenceCitation | undefined): boolean {
  const range = record.ocr_line_range;
  const locatedOnPage = nonblank(record.page_number) && Array.isArray(range) && range.length === 2
    && range.every(Number.isSafeInteger) && range[0] >= 0 && range[0] <= range[1];
  return nonblank(record.citation_id) && nonblank(record.source_doc_id) && nonblank(record.verbatim_quote)
    && Object.hasOwn(tierRank, record.credibility_tier)
    && (locatedOnPage || nonblank(record.web_section_anchor))
    && confirmation?.citation_id === record.citation_id && confirmation.source_doc_id === record.source_doc_id
    && confirmation.verbatim_quote === record.verbatim_quote && confirmation.credibility_tier === record.credibility_tier
    && confirmation.page_number === record.page_number && confirmation.web_section_anchor === record.web_section_anchor
    && confirmation.volume_or_chapter === record.volume_or_chapter
    && JSON.stringify(confirmation.ocr_line_range) === JSON.stringify(range);
}

function pinVerifiedEvent(id: string, { event, event_revision, verified_citations }: Verified) {
  if (event?.hist_event_id !== id || !nonblank(event_revision) || !Number.isFinite(event?.time_start?.julian_day_number)
      || (event.time_end !== undefined && (!Number.isFinite(event.time_end.julian_day_number)
          || event.time_end.julian_day_number < event.time_start.julian_day_number))
      || !["CONSENSUS", "T1_SCHOLARLY_DISPUTE", "PENDING_T1_VERIFICATION"].includes(event.conflict_status)
      || !Array.isArray(event.citations) || !event.citations.length || !Array.isArray(verified_citations)
      || verified_citations.length !== event.citations.length) return null;

  const citationsById = new Map(verified_citations.map((citation) => [citation?.citation_id, citation]));
  const seen = new Set<string>();
  const citation_indexes: BoundEventRevision["citation_indexes"] = [];
  let highest = 0;
  for (const citation of event.citations) {
    if (!citation || seen.has(citation.citation_id)) return null;
    const verified = citationsById.get(citation.citation_id);
    if (!verified || verified.source_doc_id !== citation.source_doc_id
        || !nonblank(verified.index_revision) || !matchCitation(citation, verified.evidence)) return null;
    seen.add(citation.citation_id);
    highest = Math.max(highest, tierRank[citation.credibility_tier]);
    citation_indexes.push({
      citation_id: citation.citation_id, source_doc_id: citation.source_doc_id, index_revision: verified.index_revision,
    });
  }
  if (!Object.hasOwn(tierRank, event.highest_credibility_tier)
      || highest !== tierRank[event.highest_credibility_tier]) return null;
  return { hist_event_id: id, event_revision, citation_indexes } satisfies BoundEventRevision;
}

async function resolveEventPins(evidence: EventEvidenceReader, eventIds: readonly string[]) {
  const resolutions = await Promise.allSettled(eventIds.map(async (id) => evidence.verifyEvent({ hist_event_id: id })));
  const blockers: GateIssue[] = [];
  const review: GateIssue[] = [];
  const pins: BoundEventRevision[] = [];
  for (const [index, resolution] of resolutions.entries()) {
    const id = eventIds[index]!;
    const result = resolution.status === "fulfilled" ? resolution.value : undefined;
    if (result && result.status === "VERIFIED") {
      const pin = pinVerifiedEvent(id, result);
      if (!pin) {
        blockers.push({
          gate: "G3", code: "UNVERIFIED_SOURCE", entity_id: id,
          message: "The event, citation location or pinned evidence revision did not match",
        });
        continue;
      }
      pins.push(pin);
      if (result.event.highest_credibility_tier !== "T1_PRIMARY_AND_LOCAL_ACADEMIC"
          || result.event.conflict_status === "PENDING_T1_VERIFICATION") review.push({
        gate: "G3", code: "PENDING_T1_VERIFICATION", entity_id: id, message: "The event requires T1 evidence before publication",
      });
      if (result.event.conflict_status === "T1_SCHOLARLY_DISPUTE") review.push({
        gate: "G4", code: "T1_SCHOLARLY_DISPUTE", entity_id: id, message: "The event requires human adjudication",
      });
      continue;
    }
    if (result && result.hist_event_id === id && Array.isArray(result.issues) && result.issues.length) {
      blockers.push(...result.issues);
      continue;
    }
    blockers.push({
      gate: "G3", code: "UNVERIFIED_SOURCE", entity_id: id, message: "The historical event evidence could not be verified",
    });
  }
  return { pins, blockers, review };
}

export async function openMapChangeSet(
  pool: Pool, evidence: EventEvidenceReader, request: OpenMapChangeSetRequest,
): Promise<OpenMapChangeSetResult> {
  if (!Array.isArray(request.bound_event_ids) || !request.bound_event_ids.length
      || !request.bound_event_ids.every(normalizedIdentifier)
      || new Set(request.bound_event_ids).size !== request.bound_event_ids.length) {
    return { status: "REJECTED", issues: [{
      gate: "G2", code: "EVENT_REQUIRED", message: "A ChangeSet requires distinct, nonempty event IDs",
    }] };
  }
  if (!uuidPattern.test(request.changeset_id) || !uuidPattern.test(request.base_revision_id)
      || ![request.epoch_id, request.branch_name, request.author_id].every(normalizedIdentifier)
      || (request.author_type !== "AI_AGENT" && request.author_type !== "HUMAN_EDITOR")) {
    throw new RangeError("Invalid ChangeSet identity, base revision, branch, epoch or author");
  }

  const normalized = {
    changeset_id: request.changeset_id.toLowerCase(),
    base_revision_id: request.base_revision_id.toLowerCase(),
    epoch_id: request.epoch_id,
    branch_name: request.branch_name,
    author_type: request.author_type,
    author_id: request.author_id,
    bound_event_ids: [...request.bound_event_ids].sort(),
  };
  const requestHash = createHash("sha256").update(JSON.stringify(normalized)).digest("hex");
  const existing = await pool.query<{ result: Opened | null }>(
    "SELECT cartography.read_open_changeset($1, $2) AS result", [normalized.changeset_id, requestHash],
  );
  if (existing.rows[0]?.result) return existing.rows[0].result;

  const revision = await pool.query(
    "SELECT 1 FROM cartography.topology_revisions WHERE revision_id = $1 AND epoch_id = $2",
    [normalized.base_revision_id, normalized.epoch_id],
  );
  if (!revision.rowCount) return { status: "REJECTED", issues: [{
    gate: "G1", code: "INVALID_TOPOLOGY", entity_id: normalized.base_revision_id,
    message: "Base topology revision was not found in the requested epoch",
  }] };

  const { pins, blockers, review } = await resolveEventPins(evidence, normalized.bound_event_ids);
  if (blockers.length) return { status: "REJECTED", issues: blockers };

  const opened = await pool.query<{ result: Opened }>(
    "SELECT cartography.open_draft_changeset($1, $2, $3, $4, $5, $6, $7, $8, $9) AS result",
    [normalized.changeset_id, normalized.base_revision_id, normalized.epoch_id, normalized.branch_name,
      normalized.author_type, normalized.author_id, requestHash, JSON.stringify(pins), JSON.stringify(review)],
  );
  const result = opened.rows[0]?.result;
  if (!result) throw new Error("Could not open the draft ChangeSet");
  return result;
}

export async function recheckMapChangeEvidence(
  database: Pick<Pool, "query">, evidence: EventEvidenceReader, changeSetId: string,
): Promise<MapChangeEvidenceCheck | null> {
  const { rows } = await database.query<{ bound_events: BoundEventRevision[] }>(`
    SELECT coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'hist_event_id', b.hist_event_id, 'event_revision', b.event_revision, 'citation_indexes', b.citation_indexes
      ) ORDER BY b.hist_event_id)
      FROM cartography.changeset_event_bindings AS b WHERE b.changeset_id = cs.changeset_id
    ), '[]'::jsonb) AS bound_events
    FROM cartography.spatial_changesets AS cs WHERE cs.changeset_id = $1
  `, [changeSetId]);
  const row = rows[0];
  if (!row) return null;
  if (!row.bound_events.length) return {
    status: "BLOCKED", bound_events: [], issues: [{ gate: "G2", code: "EVENT_REQUIRED", message: "No event binding found" }],
  };

  const { pins, blockers, review } = await resolveEventPins(evidence, row.bound_events.map((item) => item.hist_event_id));
  const issues = [...blockers, ...review];
  const freshByEvent = new Map(pins.map((pin) => [pin.hist_event_id, pin]));
  for (const recorded of row.bound_events) {
    const fresh = freshByEvent.get(recorded.hist_event_id);
    if (!fresh) continue;
    const proofs = new Map(fresh.citation_indexes.map((proof) => [proof.citation_id, proof]));
    if (fresh.event_revision !== recorded.event_revision || proofs.size !== recorded.citation_indexes.length
        || recorded.citation_indexes.some((proof) => {
          const actual = proofs.get(proof.citation_id);
          return actual?.index_revision !== proof.index_revision || actual.source_doc_id !== proof.source_doc_id;
        })) {
      issues.push({
        gate: "G3", code: "UNVERIFIED_SOURCE", entity_id: recorded.hist_event_id,
        message: "The authoritative event or citation index revision changed after the draft was opened",
      });
    }
  }
  return { status: issues.length ? "BLOCKED" : "CURRENT", bound_events: row.bound_events, issues };
}
