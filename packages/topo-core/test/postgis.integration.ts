import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { after, before, test } from "node:test";
import pg from "pg";
import type { LineString } from "geojson";
import { createHistoricalTimestamp } from "@historical-cartography/shared-schema";
import type { EventEvidenceReader, EventEvidenceResult, EvidenceCitation, HistoricalEvent } from "@historical-cartography/shared-schema";
import {
  checkSharedArcSmoothing, createDraftTopologyRevision, migrateTopology, openMapChangeSet,
  previewSharedArcSmoothing, readMapChangeDraft, readMapSnapshot, reassignBaseUnits, recheckMapChangeEvidence, registerDraftFaceLock,
  registerLandmarkInventory, registerPaleoReference, rollbackDraftReassignment,
} from "../src/index.ts";
import type {
  ArcSmoothingCheckRequest, ArcSplineRequest, DraftFaceSeed, DraftTopologyInput, PaleoLineReference,
} from "../src/index.ts";

const testDatabaseUrl = process.env.CARTOGRAPHY_TEST_DATABASE_URL;
if (!testDatabaseUrl) {
  throw new Error("Set CARTOGRAPHY_TEST_DATABASE_URL to a development PostgreSQL server with PostGIS");
}

const databaseName = `cartography_test_${randomUUID().replaceAll("-", "")}`;
const admin = new pg.Pool({ connectionString: testDatabaseUrl });
const disposableUrl = new URL(testDatabaseUrl);
disposableUrl.pathname = `/${databaseName}`;
const pool = new pg.Pool({ connectionString: disposableUrl.toString() });
let databaseCreated = false;

before(async () => {
  await admin.query(`CREATE DATABASE ${databaseName}`);
  databaseCreated = true;
  await Promise.all([migrateTopology(pool), migrateTopology(pool)]);
});

after(async () => {
  try {
    await pool.end();
    if (databaseCreated) await admin.query(`DROP DATABASE ${databaseName}`);
  } finally {
    await admin.end();
  }
});

const year = (astronomical_year: number) => createHistoricalTimestamp({ astronomical_year }).julian_day_number;
const line = (coordinates: number[][]): LineString => ({ type: "LineString", coordinates });

function face(x: number, y: number, face_id: string, control_score: number): DraftFaceSeed {
  return { seed: { type: "Point", coordinates: [x, y] }, face_id, control_score, zone_semantics: "POLITY_TERRITORY" };
}

// Schematic geometry for topology tests. Coordinates and labels make no historical claim.
function studyArea(): DraftTopologyInput {
  return {
    epoch: { epoch_id: "test-928", valid_from_jdn: year(928), valid_to_jdn: year(929) },
    coverage_boundaries: [line([[60, 36], [62, 36], [62, 38], [60, 38], [60, 36]])],
    internal_boundaries: [line([[61, 36], [61, 38]])],
    faces: [face(60.5, 37, "west", 0), { ...face(61.5, 37, "east", 100), polity_id: "engineering-fixture" }],
  };
}

function splineRequest(revision_id: string, historical_jdn: number, arc_id: string): ArcSplineRequest {
  return {
    revision_id, historical_jdn, arc_id,
    viewport: { west: 60, south: 36, east: 62, north: 38 },
    profile: {
      simplify_area_ratio: 0.00005,
      spline_tension: 0.55,
      max_hausdorff_deviation_km: 5,
    },
  };
}

test("migrations are atomic and repeatable without repeating applied work", async () => {
  const readLedger = () => pool.query<{ filename: string; sha256: string }>(
    "SELECT filename, sha256 FROM cartography_migrations.applied ORDER BY filename",
  );
  const first = await readLedger();
  assert.deepEqual(first.rows.map(({ filename }) => filename), [
    "001_topology.sql", "002_paleo_references.sql", "003_smoothing_checks.sql", "004_open_changesets.sql",
    "005_draft_unit_operations.sql",
  ]);
  await migrateTopology(pool);
  assert.deepEqual((await readLedger()).rows, first.rows);
  assert.match(first.rows[0]?.sha256 ?? "", /^[0-9a-f]{64}$/);

  await pool.query("UPDATE cartography_migrations.applied SET sha256 = 'unexpected' WHERE filename = '001_topology.sql'");
  try {
    await assert.rejects(migrateTopology(pool), /Applied migration changed: 001_topology.sql/);
  } finally {
    await pool.query("UPDATE cartography_migrations.applied SET sha256 = $1 WHERE filename = '001_topology.sql'", [
      first.rows[0]?.sha256,
    ]);
  }
});

test("the reference migration preserves drafts created on the preceding schema", async () => {
  const upgradeName = `cartography_upgrade_${randomUUID().replaceAll("-", "")}`;
  const upgradeUrl = new URL(disposableUrl);
  upgradeUrl.pathname = `/${upgradeName}`;
  await admin.query(`CREATE DATABASE ${upgradeName}`);
  const previous = new pg.Pool({ connectionString: upgradeUrl.toString() });
  try {
    const previousFilename = "001_topology.sql";
    const previousSql = (await readFile(new URL(`../migrations/${previousFilename}`, import.meta.url), "utf8"))
      .replaceAll("\r\n", "\n");
    await previous.query(previousSql);
    await previous.query(`
      CREATE SCHEMA cartography_migrations;
      CREATE TABLE cartography_migrations.applied (
        filename text PRIMARY KEY, sha256 text NOT NULL, applied_at timestamptz NOT NULL DEFAULT transaction_timestamp()
      );
    `);
    await previous.query("INSERT INTO cartography_migrations.applied (filename, sha256) VALUES ($1, $2)", [
      previousFilename, createHash("sha256").update(previousSql).digest("hex"),
    ]);
    const revisionId = randomUUID();
    const input = studyArea();
    await previous.query("SELECT cartography.build_draft_topology($1, $2, $3, $4, $5, $6, $7)", [
      revisionId, input.epoch.epoch_id, input.epoch.valid_from_jdn, input.epoch.valid_to_jdn,
      JSON.stringify(input.coverage_boundaries), JSON.stringify(input.internal_boundaries), JSON.stringify(input.faces),
    ]);
    const priorSnapshot = await previous.query("SELECT cartography.read_map_snapshot($1, $2) AS snapshot", [
      revisionId, year(928),
    ]);
    assert.equal(priorSnapshot.rows[0]?.snapshot?.data_status, "DRAFT");
    await migrateTopology(previous);
    const snapshot = await readMapSnapshot(previous, { revision_id: revisionId, historical_jdn: year(928) });
    assert.deepEqual(snapshot, priorSnapshot.rows[0]?.snapshot);
  } finally {
    await previous.end();
    await admin.query(`DROP DATABASE ${upgradeName}`);
  }
});

test("a revision yields two zero-gap faces sharing the same PostGIS edge", async () => {
  const input = studyArea();
  const revisionId = await createDraftTopologyRevision(pool, input);
  const snapshot = await readMapSnapshot(pool, { revision_id: revisionId, historical_jdn: year(928) });
  assert.ok(snapshot);
  assert.equal(snapshot.data_status, "DRAFT");
  assert.deepEqual(snapshot.epoch, input.epoch);
  assert.equal(snapshot.territories.features.length, 2);
  const shared = snapshot.boundaries.features.filter(
    ({ properties }) => properties.left_face_id !== null && properties.right_face_id !== null,
  );
  assert.equal(shared.length, 1);
  const sharedId = shared[0]?.properties.arc_id;
  assert.ok(sharedId);
  assert.ok(snapshot.territories.features.every(({ properties }) => properties.boundary_arc_ids.includes(sharedId)));
  assert.equal(snapshot.territories.features.find(({ id }) => id === "west")?.properties.control_score, 0);
  assert.equal(snapshot.territories.features.find(({ id }) => id === "east")?.properties.control_score, 100);

  const { rows } = await pool.query<{ gap: number; overlap: number }>(`
    WITH faces AS (
      SELECT ST_SetSRID(ST_GeomFromGeoJSON(feature->'geometry'), 4326) AS geom
      FROM jsonb_array_elements(($1::jsonb)->'features') AS feature
    )
    SELECT ST_Area(ST_SymDifference(ST_Union(geom), ST_MakeEnvelope(60, 36, 62, 38, 4326))) AS gap,
      sum(ST_Area(geom)) - ST_Area(ST_Union(geom)) AS overlap FROM faces
  `, [JSON.stringify(snapshot.territories)]);
  assert.deepEqual(rows, [{ gap: 0, overlap: 0 }]);
  assert.equal(await readMapSnapshot(pool, { revision_id: revisionId, historical_jdn: year(929) }), null);
});

test("crossing historic edges and concurrent hypotheses remain isolated", async () => {
  const first = studyArea();
  const second: DraftTopologyInput = {
    ...first,
    epoch: { epoch_id: "test-929", valid_from_jdn: year(929), valid_to_jdn: year(930) },
    internal_boundaries: [line([[60, 37], [62, 37]])],
    faces: [face(61, 36.5, "south", 50), face(61, 37.5, "north", 50)],
  };
  const [revisionId, hypothesisId, laterId] = await Promise.all([
    createDraftTopologyRevision(pool, first),
    createDraftTopologyRevision(pool, first),
    createDraftTopologyRevision(pool, second),
  ]);
  assert.equal(new Set([revisionId, hypothesisId, laterId]).size, 3);
  const [original, hypothesis, later] = await Promise.all([
    readMapSnapshot(pool, { revision_id: revisionId, historical_jdn: year(928) }),
    readMapSnapshot(pool, { revision_id: hypothesisId, historical_jdn: year(928) }),
    readMapSnapshot(pool, { revision_id: laterId, historical_jdn: year(929) }),
  ]);
  for (const snapshot of [original, hypothesis, later]) {
    assert.equal(snapshot?.boundaries.features.filter(
      ({ properties }) => properties.left_face_id !== null && properties.right_face_id !== null,
    ).length, 1);
  }
  const originalArc = original?.boundaries.features.find(({ properties }) => properties.left_face_id && properties.right_face_id);
  const laterArc = later?.boundaries.features.find(({ properties }) => properties.left_face_id && properties.right_face_id);
  assert.ok(originalArc?.geometry.coordinates.every(([lon]) => lon === 61));
  assert.ok(laterArc?.geometry.coordinates.every(([, lat]) => lat === 37));
  await assert.rejects(createDraftTopologyRevision(pool, {
    ...second, epoch: { ...second.epoch, epoch_id: "overlapping-epoch" },
  }), /exclusion constraint/);
});

test("failed topology construction rolls back native schemas and catalog rows", async () => {
  const inspect = () => pool.query<{ epochs: string; revisions: string; native: string }>(`
    SELECT (SELECT count(*) FROM cartography.epochs) AS epochs,
           (SELECT count(*) FROM cartography.topology_revisions) AS revisions,
           (SELECT count(*) FROM topology.topology) AS native
  `);
  const beforeAttempts = (await inspect()).rows;
  const input = studyArea();
  const newEpoch = { epoch_id: "failed-epoch", valid_from_jdn: year(930), valid_to_jdn: year(931) };
  await assert.rejects(createDraftTopologyRevision(pool, {
    ...input, epoch: newEpoch, faces: [face(60.5, 37, "west", 50)],
  }), /do not exactly cover/);
  await assert.rejects(createDraftTopologyRevision(pool, {
    ...input, epoch: newEpoch, internal_boundaries: [line([[61, 36], [61, 37]])],
  }), /do not separate two faces/);
  await assert.rejects(createDraftTopologyRevision(pool, {
    ...input, epoch: newEpoch, faces: [face(60.5, 37, "west", -1), face(61.5, 37, "east", 50)],
  }), /check constraint/);
  assert.deepEqual((await inspect()).rows, beforeAttempts);
});

test("declared coverage holes remain visible in the derived polygon", async () => {
  const input = studyArea();
  const revisionId = await createDraftTopologyRevision(pool, {
    ...input,
    epoch: { epoch_id: "declared-hole", valid_from_jdn: year(931), valid_to_jdn: year(932) },
    coverage_boundaries: [
      ...input.coverage_boundaries,
      line([[60.8, 36.8], [61.2, 36.8], [61.2, 37.2], [60.8, 37.2], [60.8, 36.8]]),
    ],
    internal_boundaries: [],
    faces: [face(60.5, 37, "study-area", 60)],
  });
  const snapshot = await readMapSnapshot(pool, { revision_id: revisionId, historical_jdn: year(931) });
  assert.equal(snapshot?.territories.features[0]?.geometry.coordinates.length, 2);
});

test("a paleo boundary uses the reference of its own epoch with zero deviation", async () => {
  const olderEpoch = { epoch_id: "paleo-before", valid_from_jdn: year(940), valid_to_jdn: year(941) };
  const currentEpoch = { epoch_id: "paleo-selected", valid_from_jdn: year(941), valid_to_jdn: year(942) };
  const prior: PaleoLineReference = {
    epoch: olderEpoch,
    feature_id: "fixture-river",
    source_doc_id: "older-engineering-fixture",
    feature_kind: "RIVER",
    geometry: line([[60.9, 36], [60.9, 38]]),
  };
  const reference: PaleoLineReference = {
    ...prior,
    epoch: currentEpoch,
    source_doc_id: "current-engineering-fixture",
    geometry: line([[61.2, 36], [61.15, 37], [61.3, 38]]),
  };
  await registerPaleoReference(pool, prior);
  await registerPaleoReference(pool, { ...prior, feature_id: "older-only" });
  await registerPaleoReference(pool, reference);
  await registerPaleoReference(pool, reference);
  await assert.rejects(registerPaleoReference(pool, { ...reference, source_doc_id: "changed-source" }), /is immutable/);

  const input: DraftTopologyInput = { ...studyArea(), epoch: currentEpoch, internal_boundaries: [] };
  await assert.rejects(createDraftTopologyRevision(pool, {
    ...input, paleo_feature_ids: ["older-only"],
  }), /unavailable in epoch paleo-selected/);

  const revisionId = await createDraftTopologyRevision(pool, {
    ...input, paleo_feature_ids: [reference.feature_id],
  });
  const snapshot = await readMapSnapshot(pool, { revision_id: revisionId, historical_jdn: year(941) });
  const snapped = snapshot?.boundaries.features.filter(
    ({ properties }) => properties.snapped_paleo_feature_id === reference.feature_id,
  );
  assert.equal(snapped?.length, 1);
  assert.ok(snapped?.[0]);
  const { rows } = await pool.query<{ distance: number }>(
    "SELECT ST_HausdorffDistance(ST_GeomFromGeoJSON($1::jsonb), ST_GeomFromGeoJSON($2::jsonb)) AS distance",
    [JSON.stringify(snapped[0].geometry), JSON.stringify(reference.geometry)],
  );
  assert.deepEqual(rows, [{ distance: 0 }]);
  const preview = await previewSharedArcSmoothing(pool, splineRequest(
    revisionId, year(941), snapped[0].properties.arc_id,
  ));
  assert.equal(preview?.status, "NATURAL_REFERENCE");
  assert.deepEqual(preview?.rendered_spline_geometry, snapped[0].geometry);
  const checked = await checkSharedArcSmoothing(pool, checkedSplineRequest(
    splineRequest(revisionId, year(941), snapped[0].properties.arc_id),
  ));
  assert.equal(checked?.gate.passed, true);
  assert.equal(checked?.texture, null);
});

test("spline candidates preserve endpoints and cannot overwrite native arcs", async () => {
  const revisionId = await createDraftTopologyRevision(pool, {
    ...studyArea(),
    epoch: { epoch_id: "spline-fixture", valid_from_jdn: year(942), valid_to_jdn: year(943) },
    internal_boundaries: [line([[61, 36], [61.075, 36.5], [60.95, 37], [61.1, 37.5], [61, 38]])],
  });
  const snapshotRequest = { revision_id: revisionId, historical_jdn: year(942) };
  const beforePreview = await readMapSnapshot(pool, snapshotRequest);
  const shared = beforePreview?.boundaries.features.find(({ properties }) => properties.left_face_id && properties.right_face_id);
  assert.ok(shared);
  const request = splineRequest(revisionId, year(942), shared.properties.arc_id);
  const preview = await previewSharedArcSmoothing(pool, request);
  assert.equal(preview?.status, "CANDIDATE");
  assert.deepEqual(preview.canonical_geometry, shared.geometry);
  assert.ok(preview.rendered_spline_geometry.coordinates.length > shared.geometry.coordinates.length);
  assert.deepEqual(preview.rendered_spline_geometry.coordinates[0], shared.geometry.coordinates[0]);
  assert.deepEqual(preview.rendered_spline_geometry.coordinates.at(-1), shared.geometry.coordinates.at(-1));
  assert.ok(preview.measured_max_deviation_km <= preview.deviation_limit_km);
  assert.ok(preview.deviation_limit_km < request.profile.max_hausdorff_deviation_km);

  const rejected = await previewSharedArcSmoothing(pool, {
    ...request, profile: { ...request.profile, max_hausdorff_deviation_km: 0.000001 },
  });
  assert.equal(rejected?.status, "REJECTED");
  assert.equal(rejected.reason, "DEVIATION_LIMIT");
  assert.deepEqual(await readMapSnapshot(pool, snapshotRequest), beforePreview);
});

function checkedSplineRequest(request: ArcSplineRequest): ArcSmoothingCheckRequest {
  return {
    ...request,
    viewport_width_px: 1_400,
    profile: { ...request.profile, target_fractal_dim_range: [1.04, 1.22], min_micro_turn_angle_deg: 135 },
  };
}

async function meanderFixture(epochId: string, astronomicalYear: number, samples: number, periods: number, amplitude: number) {
  const structure = studyArea();
  const jdn = year(astronomicalYear);
  const boundary = Array.from({ length: samples + 1 }, (_, index) => {
    const t = index / samples;
    return [61 + amplitude * Math.sin(2 * Math.PI * periods * t), 36 + 2 * t];
  });
  const revisionId = await createDraftTopologyRevision(pool, {
    ...structure,
    epoch: { epoch_id: epochId, valid_from_jdn: jdn, valid_to_jdn: year(astronomicalYear + 1) },
    internal_boundaries: [line(boundary)],
  });
  const snapshot = await readMapSnapshot(pool, { revision_id: revisionId, historical_jdn: jdn });
  assert.ok(snapshot);
  const edge = snapshot.boundaries.features.find(({ properties }) => properties.left_face_id && properties.right_face_id);
  assert.ok(edge);
  const request = checkedSplineRequest(splineRequest(revisionId, jdn, edge.properties.arc_id));
  request.profile.simplify_area_ratio = 0;
  return { request, snapshot };
}

test("G1.5 measures a valid meander and rejects a straight boundary instead of treating missing anchors as success", async () => {
  const normal = await meanderFixture("normal-shape", 945, 128, 8, 0.065);
  const unregistered = await checkSharedArcSmoothing(pool, normal.request);
  assert.equal(unregistered?.gate.passed, false);
  assert.match(unregistered.gate.issues.map(({ message }) => message).join("\n"), /no registered landmark inventory/);
  await registerLandmarkInventory(pool, normal.request.revision_id, [{
    coordinates: [60.5, 37], toponym_id: "safe-fixture", valid_from_jdn: year(945), valid_to_jdn: year(946),
  }]);
  const checked = await checkSharedArcSmoothing(pool, normal.request);
  assert.equal(checked?.gate.passed, true, JSON.stringify(checked?.gate.issues));
  assert.ok(checked.texture?.measured_fractal_dim);
  assert.ok(checked.texture.measured_fractal_dim >= 1.04 && checked.texture.measured_fractal_dim <= 1.22);
  const strictAngles = await checkSharedArcSmoothing(pool, {
    ...normal.request,
    viewport_width_px: 320,
    profile: { ...normal.request.profile, min_micro_turn_angle_deg: 179.9 },
  });
  assert.equal(strictAngles?.gate.passed, false);
  assert.match(strictAngles.gate.issues.map(({ message }) => message).join("\n"), /Micro-turn angle/);

  const straight = await meanderFixture("straight-shape", 946, 8, 1, 0);
  await registerLandmarkInventory(pool, straight.request.revision_id, []);
  const rejected = await checkSharedArcSmoothing(pool, straight.request);
  assert.equal(rejected?.gate.passed, false);
  assert.match(rejected.gate.issues.map(({ message }) => message).join("\n"), /fractal dimension/);
  assert.deepEqual(await readMapSnapshot(pool, normal.request), normal.snapshot);
});

test("G1.5 reports a landmark crossing and removes its scratch topology", async () => {
  const { request, snapshot } = await meanderFixture("crossing-shape", 947, 64, 6, 0.065);
  const preview = await previewSharedArcSmoothing(pool, request);
  assert.equal(preview?.status, "CANDIDATE");
  const { rows } = await pool.query<{ x: number; y: number }>(`
    WITH curves AS (
      SELECT ST_GeomFromGeoJSON($1::jsonb) AS before, ST_GeomFromGeoJSON($2::jsonb) AS after
    ), comparisons AS (
      SELECT ST_MakeLine(
        p.geom, ST_ClosestPoint(curves.before, p.geom)
      ) AS displacement
      FROM curves CROSS JOIN LATERAL ST_DumpPoints(curves.after) AS p
    )
    SELECT ST_X(ST_LineInterpolatePoint(displacement, 0.5)) AS x,
      ST_Y(ST_LineInterpolatePoint(displacement, 0.5)) AS y
    FROM comparisons ORDER BY ST_Length(displacement) DESC LIMIT 1
  `, [JSON.stringify(preview.canonical_geometry), JSON.stringify(preview.rendered_spline_geometry)]);
  const point = rows[0];
  assert.ok(point);
  const anchor = {
    coordinates: [point.x, point.y] as [number, number], toponym_id: "on-the-swept-strip",
    valid_from_jdn: year(947), valid_to_jdn: year(948),
  };
  await registerLandmarkInventory(pool, request.revision_id, [anchor]);
  await registerLandmarkInventory(pool, request.revision_id, [anchor]);
  await assert.rejects(registerLandmarkInventory(pool, request.revision_id, []), /immutable/);
  const checked = await checkSharedArcSmoothing(pool, request);
  assert.ok(checked?.gate.issues.some(({ code, entity_id }) =>
    code === "TOPONYM_FACE_CHANGED" && entity_id === anchor.toponym_id), JSON.stringify(checked?.gate.issues));
  assert.deepEqual(await readMapSnapshot(pool, request), snapshot);
  const scratch = await pool.query("SELECT name FROM topology.topology WHERE name LIKE 'carto_spline_%'");
  assert.equal(scratch.rowCount, 0);
});

test("native spline inspection rejects a neighbouring edge crossing", async () => {
  const revisionId = await createDraftTopologyRevision(pool, {
    ...studyArea(),
    epoch: { epoch_id: "adjacent-edge-fixture", valid_from_jdn: year(948), valid_to_jdn: year(949) },
    internal_boundaries: [line([[61, 36], [61, 38]]), line([[61.006, 36], [61.006, 38]])],
    faces: [face(60.5, 37, "west", 55), face(61.003, 37, "middle", 55), face(61.5, 37, "east", 55)],
  });
  const snapshot = await readMapSnapshot(pool, { revision_id: revisionId, historical_jdn: year(948) });
  const edge = snapshot?.boundaries.features.find(({ geometry }) => geometry.coordinates.every(([x]) => x === 61));
  assert.ok(edge);
  const edgeId = edge.properties.arc_id.split(":").at(-1);
  const original = edge.geometry.coordinates;
  const { rows } = await pool.query<{ topology_error: string }>(
    "SELECT * FROM cartography.check_draft_spline($1, $2, $3)",
    [revisionId, edgeId, JSON.stringify(line([original[0]!, [61.009, 37], original.at(-1)!]))],
  );
  assert.match(rows[0]?.topology_error ?? "", /non-boundary intersection/i);
  assert.deepEqual(await readMapSnapshot(pool, { revision_id: revisionId, historical_jdn: year(948) }), snapshot);
});

async function changeSetRequest(name: string, astronomicalYear: number) {
  const epoch = {
    epoch_id: name, valid_from_jdn: year(astronomicalYear), valid_to_jdn: year(astronomicalYear + 1),
  };
  const base_revision_id = await createDraftTopologyRevision(pool, { ...studyArea(), epoch });
  return {
    changeset_id: randomUUID(), epoch_id: epoch.epoch_id, base_revision_id, branch_name: "working",
    author_id: "fixture-editor", author_type: "AI_AGENT" as const, bound_event_ids: ["fixture-event"],
  };
}

// Adapter response fixtures check the storage boundary. Real source OCR and
// archive verification belong to the scholarship service integration suite.
function verifiedEvent(
  hist_event_id: string,
  credibility_tier: EvidenceCitation["credibility_tier"] = "T1_PRIMARY_AND_LOCAL_ACADEMIC",
  conflict_status: HistoricalEvent["conflict_status"] = "CONSENSUS",
): Extract<EventEvidenceResult, { status: "VERIFIED" }> {
  const citation: EvidenceCitation = {
    citation_id: `${hist_event_id}-citation`, source_doc_id: "evidence-contract-fixture", credibility_tier,
    page_number: "1", ocr_line_range: [3, 3], verbatim_quote: "Synthetic citation for interface testing.",
    verified_by_human: false,
  };
  return {
    status: "VERIFIED",
    event_revision: "event-v1",
    event: {
      hist_event_id, title: "Engineering fixture", summary: "Draft opening test",
      event_category: "OTHER", time_start: createHistoricalTimestamp({ astronomical_year: 950 }),
      involved_polity_ids: [], involved_toponym_ids: [], involved_figure_ids: [],
      spatial_impact_description: "Synthetic case", citations: [citation],
      highest_credibility_tier: credibility_tier, conflict_status,
    },
    verified_citations: [{
      citation_id: citation.citation_id, source_doc_id: citation.source_doc_id, index_revision: "index-v1",
      evidence: { ...citation },
    }],
  };
}

test("opening a change set pins evidence and supports concurrent idempotent retries", async () => {
  const request = await changeSetRequest("draft-change-open", 950);
  const reader: EventEvidenceReader = { async verifyEvent({ hist_event_id }) { return verifiedEvent(hist_event_id); } };
  const [first, concurrent] = await Promise.all([
    openMapChangeSet(pool, reader, request), openMapChangeSet(pool, reader, request),
  ]);
  assert.equal(first.status, "OPENED");
  assert.equal(first.changeset.status, "DRAFT");
  assert.equal(first.changeset.gate_report.g2_event_binding_passed, true);
  assert.equal(first.changeset.gate_report.g1_topology_passed, false);
  assert.deepEqual(first.bound_events, [{
    hist_event_id: "fixture-event", event_revision: "event-v1", citation_indexes: [{
      citation_id: "fixture-event-citation", source_doc_id: "evidence-contract-fixture", index_revision: "index-v1",
    }],
  }]);
  assert.deepEqual(concurrent, first);
  const unreachable = { async verifyEvent() { assert.fail("Retry must reuse pinned evidence"); } };
  assert.deepEqual(await openMapChangeSet(pool, unreachable, request), first);
  await assert.rejects(openMapChangeSet(pool, unreachable, { ...request, branch_name: "other" }), /different request/);
  const counts = await pool.query<{ changesets: number; bindings: number }>(
    `SELECT (SELECT count(*)::int FROM cartography.spatial_changesets WHERE changeset_id = $1) AS changesets,
            (SELECT count(*)::int FROM cartography.changeset_event_bindings WHERE changeset_id = $1) AS bindings`,
    [request.changeset_id],
  );
  assert.deepEqual(counts.rows, [{ changesets: 1, bindings: 1 }]);
});

test("draft opening rejects missing bindings and mismatched quotations without residual writes", async () => {
  const request = await changeSetRequest("draft-change-reject", 951);
  const unreachable = { async verifyEvent() { assert.fail("Invalid request must not query evidence"); } };
  const noEvents = await openMapChangeSet(pool, unreachable, { ...request, bound_event_ids: [] });
  assert.equal(noEvents.status, "REJECTED");
  assert.equal(noEvents.issues[0]?.code, "EVENT_REQUIRED");
  const wrongEpoch = await openMapChangeSet(pool, unreachable, { ...request, epoch_id: "different-epoch" });
  assert.equal(wrongEpoch.status, "REJECTED");
  assert.equal(wrongEpoch.issues[0]?.code, "INVALID_TOPOLOGY");
  const mismatched: EventEvidenceReader = {
    async verifyEvent({ hist_event_id }) {
      const response = verifiedEvent(hist_event_id);
      if (hist_event_id === "wrong-page") response.verified_citations[0]!.evidence.page_number = "2";
      return response;
    },
  };
  const rejected = await openMapChangeSet(pool, mismatched, {
    ...request, bound_event_ids: ["valid-fixture", "wrong-page"],
  });
  assert.equal(rejected.status, "REJECTED");
  assert.equal(rejected.issues[0]?.entity_id, "wrong-page");
  const unavailable = await openMapChangeSet(pool, {
    async verifyEvent() { throw new Error("Simulated service connection failure"); },
  }, request);
  assert.equal(unavailable.status, "REJECTED");
  const rows = await pool.query("SELECT * FROM cartography.change_branches WHERE epoch_id = $1", [request.epoch_id]);
  assert.equal(rows.rowCount, 0);
});

test("a verified lower-tier or disputed draft remains pending human review", async () => {
  const request = await changeSetRequest("draft-change-review", 952);
  const reader: EventEvidenceReader = {
    async verifyEvent({ hist_event_id }) {
      return hist_event_id === "in-dispute"
        ? verifiedEvent(hist_event_id, "T1_PRIMARY_AND_LOCAL_ACADEMIC", "T1_SCHOLARLY_DISPUTE")
        : verifiedEvent(hist_event_id, "T3_GENERAL_ENCYCLOPEDIA");
    },
  };
  const result = await openMapChangeSet(pool, reader, { ...request, bound_event_ids: ["in-dispute", "only-lead"] });
  assert.equal(result.status, "OPENED");
  assert.equal(result.changeset.status, "PENDING_HUMAN_REVIEW");
  assert.equal(result.changeset.gate_report.g3_provenance_quote_passed, false);
  assert.deepEqual(result.issues.map(({ code }) => code), ["T1_SCHOLARLY_DISPUTE", "PENDING_T1_VERIFICATION"]);
});

async function openedFixtureDraft(epoch: string, astronomicalYear: number) {
  const request = await changeSetRequest(epoch, astronomicalYear);
  const result = await openMapChangeSet(pool, {
    async verifyEvent({ hist_event_id }) { return verifiedEvent(hist_event_id); },
  }, request);
  assert.equal(result.status, "OPENED");
  return request;
}

test("unit reassignment preserves the previous geometry, records event impacts and rejects stale updates", async () => {
  const draft = await openedFixtureDraft("unit-edit", 953);
  const baseRequest = { revision_id: draft.base_revision_id, historical_jdn: year(953) };
  const original = await readMapSnapshot(pool, baseRequest);
  assert.ok(original);
  const request = {
    changeset_id: draft.changeset_id, operation_id: randomUUID(), expected_revision_id: draft.base_revision_id,
    driven_by_event_ids: draft.bound_event_ids, assignments: [{ face_id: "west", polity_id: "transfer-fixture", control_score: 52 }],
  };
  const [first, duplicate] = await Promise.all([reassignBaseUnits(pool, request), reassignBaseUnits(pool, request)]);
  assert.deepEqual(first, duplicate);
  assert.equal(first.status, "APPLIED");
  assert.deepEqual(first.moved_face_ids, ["west"]);
  assert.deepEqual(first.driven_by_event_ids, draft.bound_event_ids);
  const updated = await readMapSnapshot(pool, { ...baseRequest, revision_id: first.revision_id });
  assert.ok(updated);
  assert.equal(updated.data_status, "DRAFT");
  const west = updated.territories.features.find(({ id }) => id === "west");
  assert.equal(west?.properties.polity_id, "transfer-fixture");
  assert.equal(west?.properties.control_score, 52);
  assert.deepEqual(updated.territories.features.map(({ geometry }) => geometry), original.territories.features.map(({ geometry }) => geometry));
  assert.ok(first.affected_arc_ids.some((id) => updated.boundaries.features.some(({ properties }) =>
    properties.arc_id === id && properties.left_face_id !== null && properties.right_face_id !== null,
  )));
  assert.deepEqual(await readMapSnapshot(pool, baseRequest), original);
  assert.deepEqual(await readMapChangeDraft(pool, draft.changeset_id), { revision_id: first.revision_id, operations: [first] });
  await assert.rejects(reassignBaseUnits(pool, { ...request, operation_id: randomUUID() }), { code: "40001" });
});

test("foreign events and human-locked units abort the whole reassignment", async () => {
  const draft = await openedFixtureDraft("unit-lock", 954);
  const request = {
    changeset_id: draft.changeset_id, operation_id: randomUUID(), expected_revision_id: draft.base_revision_id,
    driven_by_event_ids: draft.bound_event_ids,
    assignments: [
      { face_id: "west", polity_id: "transfer-fixture", control_score: 20 },
      { face_id: "east", polity_id: null, control_score: 60 },
    ],
  };
  await assert.rejects(reassignBaseUnits(pool, { ...request, driven_by_event_ids: ["unbound"] }), /bound to the ChangeSet/);
  await registerDraftFaceLock(pool, draft.base_revision_id, "east");
  await assert.rejects(reassignBaseUnits(pool, request), { constraint: "draft_face_human_lock", detail: "east" });
  assert.deepEqual(await readMapChangeDraft(pool, draft.changeset_id), { revision_id: draft.base_revision_id, operations: [] });
  const revisionCount = await pool.query("SELECT revision_id FROM cartography.topology_revisions WHERE epoch_id = $1", [draft.epoch_id]);
  assert.equal(revisionCount.rowCount, 1);
});

test("rolling back draft operations restores each prior revision and retains audit history", async () => {
  const draft = await openedFixtureDraft("unit-rollback", 955);
  const request = {
    changeset_id: draft.changeset_id, operation_id: randomUUID(), expected_revision_id: draft.base_revision_id,
    driven_by_event_ids: draft.bound_event_ids, assignments: [{ face_id: "west", polity_id: "fixture-first", control_score: 20 }],
  };
  const first = await reassignBaseUnits(pool, request);
  const second = await reassignBaseUnits(pool, {
    ...request, operation_id: randomUUID(), expected_revision_id: first.revision_id,
    assignments: [{ face_id: "west", polity_id: "fixture-second", control_score: 80 }],
  });
  await assert.rejects(rollbackDraftReassignment(pool, draft.changeset_id, first.operation_id), /active draft operation/);
  const undoneSecond = await rollbackDraftReassignment(pool, draft.changeset_id, second.operation_id);
  assert.equal(undoneSecond.status, "ROLLED_BACK");
  assert.deepEqual(await rollbackDraftReassignment(pool, draft.changeset_id, second.operation_id), undoneSecond);
  assert.equal((await readMapChangeDraft(pool, draft.changeset_id))?.revision_id, first.revision_id);
  const undoneFirst = await rollbackDraftReassignment(pool, draft.changeset_id, first.operation_id);
  assert.equal(undoneFirst.status, "ROLLED_BACK");
  assert.deepEqual(await readMapChangeDraft(pool, draft.changeset_id), {
    revision_id: draft.base_revision_id, operations: [undoneFirst, undoneSecond],
  });
  assert.deepEqual(await reassignBaseUnits(pool, request), undoneFirst);
  assert.ok(await readMapSnapshot(pool, { revision_id: second.revision_id, historical_jdn: year(955) }));
});

test("a fresh evidence check blocks changed index revisions even when the event ID remains the same", async () => {
  const draft = await openedFixtureDraft("audit-evidence", 956);
  const reader: EventEvidenceReader = {
    async verifyEvent({ hist_event_id }) { return verifiedEvent(hist_event_id); },
  };
  const current = await recheckMapChangeEvidence(pool, reader, draft.changeset_id);
  assert.equal(current?.status, "CURRENT");
  const stale = await recheckMapChangeEvidence(pool, {
    async verifyEvent({ hist_event_id }) {
      const response = verifiedEvent(hist_event_id);
      response.verified_citations[0]!.index_revision = "index-v2";
      return response;
    },
  }, draft.changeset_id);
  assert.equal(stale?.status, "BLOCKED");
  assert.match(stale.issues[0]?.message ?? "", /index revision changed/);
  assert.deepEqual(stale.bound_events, current.bound_events);
});
