import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import pg from "pg";
import type { LineString } from "geojson";
import { createHistoricalTimestamp } from "@historical-cartography/shared-schema";
import { createDraftTopologyRevision, migrateTopology, readMapSnapshot } from "../src/index.ts";
import type { DraftFaceSeed, DraftTopologyInput } from "../src/index.ts";

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

test("migrations are atomic and repeatable without repeating applied work", async () => {
  const readLedger = () => pool.query<{ filename: string; sha256: string }>(
    "SELECT filename, sha256 FROM cartography_migrations.applied",
  );
  const first = await readLedger();
  assert.equal(first.rowCount, 1);
  await migrateTopology(pool);
  assert.deepEqual((await readLedger()).rows, first.rows);
  assert.match(first.rows[0]?.sha256 ?? "", /^[0-9a-f]{64}$/);

  await pool.query("UPDATE cartography_migrations.applied SET sha256 = 'unexpected'");
  try {
    await assert.rejects(migrateTopology(pool), /Applied migration changed: 001_topology.sql/);
  } finally {
    await pool.query("UPDATE cartography_migrations.applied SET sha256 = $1", [first.rows[0]?.sha256]);
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
