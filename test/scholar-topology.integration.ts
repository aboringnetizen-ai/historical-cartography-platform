import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, readFile, rmdir, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import pg from "pg";
import { createHistoricalTimestamp } from "@historical-cartography/shared-schema";
import type { HistoricalEvent, SourceDocument } from "@historical-cartography/shared-schema";
import { ScholarEvents } from "@historical-cartography/scholar-agent/events";
import { EvidenceStore } from "@historical-cartography/scholar-agent/evidence";
import {
  createDraftTopologyRevision, migrateTopology, openMapChangeSet, readMapChangeDraft,
  readMapSnapshot, reassignBaseUnits, submitMapChangeForReview,
} from "@historical-cartography/topo-core";

const databaseUrl = process.env.CARTOGRAPHY_TEST_DATABASE_URL;
if (!databaseUrl) throw new Error("Set CARTOGRAPHY_TEST_DATABASE_URL to a development PostgreSQL/PostGIS server");

const directory = await mkdtemp(join(tmpdir(), "cartography-scholar-"));
const sourcePath = join(directory, "voyage.txt");
const eventPath = join(directory, "events.sqlite");
const databaseName = "cartography_scholar_" + randomUUID().replaceAll("-", "");
const admin = new pg.Pool({ connectionString: databaseUrl });
const isolated = new URL(databaseUrl);
isolated.pathname = "/" + databaseName;

test("a reviewed transcription reaches spatial review; changing the original blocks old drafts", async (t) => {
  await admin.query("CREATE DATABASE " + databaseName);
  const pool = new pg.Pool({ connectionString: isolated.toString() });
  t.after(async () => {
    try {
      await pool.end();
      await admin.query("DROP DATABASE " + databaseName);
    } finally {
      await admin.end();
    }
  });
  const bytes = await readFile(new URL("../packages/scholar-agent/fixtures/voyage-excerpt.txt", import.meta.url));
  const reviewedSha = "2b22332de5962857216b522f16821c827e9c132252a00b144864368aa1d81b3b";
  assert.equal(createHash("sha256").update(bytes).digest("hex"), reviewedSha);
  await writeFile(sourcePath, bytes);
  const index = new EvidenceStore();
  const events = new ScholarEvents(eventPath, index);
  t.after(async () => {
    events.close();
    await unlink(sourcePath);
    await unlink(eventPath);
    await rmdir(directory);
  });
  await migrateTopology(pool);

  const document: SourceDocument = {
    source_doc_id: "voyage", title: "The Voyage of the Beagle", authors: ["Charles Darwin"],
    is_local_academic_journal: false, medium: "LOCAL_FILE", credibility_tier: "T1_PRIMARY_AND_LOCAL_ACADEMIC",
    language: "en", local_path: sourcePath, source_url: "https://www.gutenberg.org/ebooks/944",
    ocr_indexed: false,
  };
  const operatorReview = {
    file_sha256: reviewedSha,
    basis: "Pinned Project Gutenberg transcription, ch. I, lines 159–161; port-call evidence only",
  };
  const indexed = await index.indexNativeFile(document, undefined, operatorReview);
  const event: HistoricalEvent = {
    hist_event_id: "voyage-port-call", title: "Darwin records a port call", summary: "Porto Praya appears in the voyage account",
    event_category: "OTHER", time_start: createHistoricalTimestamp({ astronomical_year: 1832, month: 1, day: 16 }),
    involved_polity_ids: [], involved_figure_ids: [], involved_toponym_ids: ["Porto Praya"],
    spatial_impact_description: "Evidence of an attested place name only. All topology in this test is synthetic.",
    citations: [{
      citation_id: "voyage-original", source_doc_id: document.source_doc_id, credibility_tier: "T1_PRIMARY_AND_LOCAL_ACADEMIC",
      page_number: "file:1", ocr_line_range: [1, 2],
      verbatim_quote: "On the 16th of January, 1832, we anchored at Porto Praya", verified_by_human: false,
    }],
    highest_credibility_tier: "T1_PRIMARY_AND_LOCAL_ACADEMIC", conflict_status: "CONSENSUS",
  };
  const pinned = await events.register(event, { voyage: indexed.index_revision });
  assert.equal(pinned.stored, true);
  assert.equal(pinned.result.status, "VERIFIED");

  const historical_jdn = event.time_start.julian_day_number;
  const epoch = {
    epoch_id: "voyage-interface-fixture", valid_from_jdn: historical_jdn, valid_to_jdn: historical_jdn + 1,
  };
  const baseRevision = await createDraftTopologyRevision(pool, {
    epoch,
    coverage_boundaries: [{ type: "LineString", coordinates: [[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]] }],
    internal_boundaries: [],
    faces: [{
      face_id: "test-unit", seed: { type: "Point", coordinates: [0.5, 0.5] },
      control_score: 0, zone_semantics: "POLITY_TERRITORY",
    }],
  });
  async function openAndEdit() {
    const changeset_id = randomUUID();
    const opened = await openMapChangeSet(pool, events, {
      changeset_id, base_revision_id: baseRevision, epoch_id: epoch.epoch_id, branch_name: "interface-test",
      author_type: "AI_AGENT", author_id: "integration-fixture", bound_event_ids: [event.hist_event_id],
    });
    assert.equal(opened.status, "OPENED");
    assert.equal(opened.bound_events[0]?.event_revision, pinned.event_revision);
    const applied = await reassignBaseUnits(pool, {
      changeset_id, operation_id: randomUUID(), expected_revision_id: baseRevision,
      driven_by_event_ids: [event.hist_event_id],
      assignments: [{ face_id: "test-unit", control_score: 25, polity_id: "engineering-only" }],
    });
    return { changeset_id, expected_revision_id: applied.revision_id };
  }

  const first = await openAndEdit();
  const second = await openAndEdit();
  const submitted = await submitMapChangeForReview(pool, events, first);
  assert.equal(submitted.status, "SUBMITTED_FOR_REVIEW");

  const tampered = bytes.toString("utf8").replace("16th of", "17th of");
  assert.notEqual(tampered, bytes.toString("utf8"));
  await writeFile(sourcePath, tampered);
  await assert.rejects(index.indexNativeFile(document, undefined, operatorReview), /审阅依据未绑定当前文件/);
  const staleEvent = await events.verifyEvent({ hist_event_id: event.hist_event_id });
  assert.equal(staleEvent.status, "REJECTED");
  assert.equal(staleEvent.issues[0]?.code, "UNVERIFIED_SOURCE");

  const selfClaimed = await events.register(
    { ...event, hist_event_id: "self-claimed-t1-after-replacement" }, { voyage: indexed.index_revision },
  );
  assert.equal(selfClaimed.stored, false);
  assert.equal(selfClaimed.result.status, "REJECTED");
  assert.equal(selfClaimed.result.issues[0]?.code, "UNVERIFIED_SOURCE");
  for (const request of [first, second]) {
    const outcome = await submitMapChangeForReview(pool, events, request);
    assert.equal(outcome.status, "BLOCKED");
    assert.equal(outcome.reason, "EVIDENCE");
    assert.equal(outcome.issues[0]?.code, "UNVERIFIED_SOURCE");
    const draft = await readMapChangeDraft(pool, request.changeset_id);
    assert.equal(draft?.revision_id, request.expected_revision_id);
    const snapshot = await readMapSnapshot(pool, { revision_id: request.expected_revision_id, historical_jdn });
    assert.equal(snapshot?.data_status, "DRAFT");
  }
  const reviews = await pool.query<{ review_id: string; invalidated: boolean }>(
    "SELECT review_id, invalidated_at IS NOT NULL AS invalidated FROM cartography.map_review_submissions",
  );
  assert.deepEqual(reviews.rows, [{ review_id: submitted.review_id, invalidated: true }]);

  await writeFile(sourcePath, bytes);
  const newer = await events.register({ ...event, summary: "Reviewed description, same cited passage" },
    { voyage: indexed.index_revision }, pinned.event_revision);
  assert.equal(newer.result.status, "VERIFIED");
  assert.notEqual(newer.event_revision, pinned.event_revision);
  const changedVersion = await submitMapChangeForReview(pool, events, second);
  assert.equal(changedVersion.status, "BLOCKED");
  assert.equal(changedVersion.reason, "EVIDENCE");
  assert.match(changedVersion.issues[0]?.message ?? "", /event or citation index revision changed/);
});
