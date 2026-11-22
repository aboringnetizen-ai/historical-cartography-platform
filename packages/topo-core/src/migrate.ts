import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { Pool } from "pg";

const migrations = [
  new URL("../migrations/001_topology.sql", import.meta.url),
];

export async function migrateTopology(pool: Pool): Promise<void> {
  const client = await pool.connect();
  let discardClient = false;
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(20261122, 401)");
    await client.query(`
      CREATE SCHEMA IF NOT EXISTS cartography_migrations;
      CREATE TABLE IF NOT EXISTS cartography_migrations.applied (
        filename text PRIMARY KEY,
        sha256 text NOT NULL,
        applied_at timestamptz NOT NULL DEFAULT transaction_timestamp()
      );
    `);
    for (const location of migrations) {
      const filename = location.pathname.split("/").at(-1);
      const sql = (await readFile(location, "utf8")).replaceAll("\r\n", "\n");
      const checksum = createHash("sha256").update(sql).digest("hex");
      const { rows } = await client.query<{ sha256: string }>(
        "SELECT sha256 FROM cartography_migrations.applied WHERE filename = $1", [filename],
      );
      if (rows[0]) {
        if (rows[0].sha256 !== checksum) {
          throw new Error(`Applied migration changed: ${filename}`);
        }
        continue;
      }
      await client.query(sql);
      await client.query(
        "INSERT INTO cartography_migrations.applied(filename, sha256) VALUES ($1, $2)",
        [filename, checksum],
      );
    }
    await client.query("COMMIT");
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
