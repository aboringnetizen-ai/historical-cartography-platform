import { once } from "node:events";
import pg from "pg";
import { createEngineeringStudioProject, loadStudioProject } from "./studio-project.ts";

const database = process.env.CARTOGRAPHY_DATABASE_URL;
const projectFile = process.env.CARTOGRAPHY_STUDIO_PROJECT;
const fixture = process.argv.length === 3 && process.argv[2] === "--engineering-fixture";
if (!database || fixture === Boolean(projectFile)) {
  throw new Error("Set CARTOGRAPHY_DATABASE_URL and use either CARTOGRAPHY_STUDIO_PROJECT or --engineering-fixture");
}
const port = Number(process.env.CARTOGRAPHY_STUDIO_PORT ?? "4195");
if (!Number.isSafeInteger(port) || port < 1 || port > 65535) throw new Error("Invalid studio API port");

const pool = new pg.Pool({ connectionString: database });
try {
  const running = fixture ? await createEngineeringStudioProject(pool) : await loadStudioProject(pool, projectFile!);
  try {
    running.server.listen(port, "127.0.0.1");
    await once(running.server, "listening");
    console.log("Studio API listening on http://127.0.0.1:" + port);
    await new Promise<void>((resolve) => {
      process.once("SIGINT", resolve);
      process.once("SIGTERM", resolve);
    });
  } finally {
    if (running.server.listening) await new Promise<void>((resolve) => running.server.close(() => resolve()));
    running.closeEvidence();
  }
} finally {
  await pool.end();
}
