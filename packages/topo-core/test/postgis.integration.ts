import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { after, before, test } from "node:test";
import pg from "pg";
import type { LineString } from "geojson";
import { createHistoricalTimestamp } from "@historical-cartography/shared-schema";
import {
  createDraftTopologyRevision, migrateTopology, previewSharedArcSmoothing, readMapSnapshot, registerPaleoReference,
} from "../src/index.ts";
import type { ArcSplineRequest, DraftFaceSeed, DraftTopologyInput, PaleoLineReference } from "../src/index.ts";

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
  assert.deepEqual(first.rows.map(({ filename }) => filename), ["001_topology.sql", "002_paleo_references.sql"]);
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
