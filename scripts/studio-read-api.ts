import { createServer } from "node:http";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import type {
  EpochSceneBundle, EventEvidenceReader, EventEvidenceResult, SourceDocument, StudioSceneIndexItem,
} from "@historical-cartography/shared-schema";
import { readMapChangeDiff, readMapSnapshot } from "@historical-cartography/topo-core";
import type { Pool } from "pg";

export interface StudioSceneRegistration {
  revision_id: string;
  sample_jdn: number;
  draft_changeset_id?: string;
  epoch_label_zh: string;
  historical_year_display: string;
  default_camera: EpochSceneBundle["default_camera"];
  is_demo_fixture?: boolean;
  calendar_era_note?: string;
  event_ids?: readonly string[];
  toponyms?: EpochSceneBundle["toponyms"];
  polities?: EpochSceneBundle["polities"];
  admin_units?: EpochSceneBundle["admin_units"];
  admin_evolutions?: EpochSceneBundle["admin_evolutions"];
  paleo_overlays?: EpochSceneBundle["paleo_overlays"];
}

export interface StudioReadApiOptions {
  pool: Pool;
  evidence: EventEvidenceReader;
  scenes: readonly StudioSceneRegistration[];
  sources?: readonly SourceDocument[];
}

const UUID_PATTERN = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const MAX_BODY_BYTES = 16 * 1024;
type JsonObject = Record<string, unknown>;

class RequestError extends Error {
  readonly statusCode: number;

  constructor(statusCode: number, message: string) {
    super(message);
    this.statusCode = statusCode;
  }
}

function send(response: ServerResponse, status: number, payload: object): void {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(JSON.stringify(payload));
}

async function readObject(request: IncomingMessage): Promise<JsonObject> {
  if (request.headers["content-type"]?.split(";")[0]?.trim().toLowerCase() !== "application/json") {
    throw new RequestError(415, "Expected a JSON request");
  }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request.iterator({ destroyOnReturn: false })) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += bytes.byteLength;
    if (size > MAX_BODY_BYTES) {
      throw new RequestError(413, "JSON request is too large");
    }
    chunks.push(bytes);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new RequestError(400, "Malformed JSON request");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new RequestError(400, "Expected a JSON object");
  }
  return parsed as JsonObject;
}

function metadataIsValid(scene: StudioSceneRegistration): boolean {
  const center = scene.default_camera?.center;
  return UUID_PATTERN.test(scene.revision_id) && Number.isFinite(scene.sample_jdn)
    && (scene.draft_changeset_id === undefined || UUID_PATTERN.test(scene.draft_changeset_id))
    && typeof scene.epoch_label_zh === "string" && Boolean(scene.epoch_label_zh.trim())
    && typeof scene.historical_year_display === "string" && Boolean(scene.historical_year_display.trim())
    && Array.isArray(center) && center.length === 2
    && Number.isFinite(center[0]) && Math.abs(center[0]) <= 180
    && Number.isFinite(center[1]) && Math.abs(center[1]) <= 90
    && Number.isFinite(scene.default_camera.zoom) && scene.default_camera.zoom >= 0
    && (scene.event_ids === undefined || (Array.isArray(scene.event_ids)
      && scene.event_ids.every((id) => typeof id === "string" && id.length > 0 && id.length <= 256)));
}

function publicSource(source: SourceDocument): SourceDocument {
  const { local_path: _privateFile, ...publicFields } = source;
  return publicFields;
}

export async function createStudioReadApi(options: StudioReadApiOptions): Promise<Server> {
  if (!options.scenes.length) throw new Error("At least one studio scene is required");
  const catalog = await Promise.all(options.scenes.map(async (scene) => {
    if (!metadataIsValid(scene)) throw new Error("Invalid studio scene registration");
    const snapshot = await readMapSnapshot(options.pool, { revision_id: scene.revision_id, historical_jdn: scene.sample_jdn });
    if (!snapshot) throw new Error("A studio scene points to a missing revision or a time outside its epoch");
    const summary: StudioSceneIndexItem = {
      epoch: snapshot.epoch, epoch_label_zh: scene.epoch_label_zh, revision_id: snapshot.revision_id,
      sample_jdn: scene.sample_jdn, data_status: snapshot.data_status, is_demo_fixture: scene.is_demo_fixture === true,
    };
    return { scene, summary };
  }));
  if (new Set(catalog.map(({ summary }) => summary.revision_id)).size !== catalog.length) {
    throw new Error("A revision may appear only once in the scene catalog");
  }
  const allowedEvents = new Set(catalog.flatMap(({ scene }) => scene.event_ids ?? []));
  const sourcesById = new Map((options.sources ?? []).map((s) => [s.source_doc_id, publicSource(s)]));

  async function route(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const path = request.url;
    if (path === "/api/v4/scenes") {
      if (request.method !== "GET") throw new RequestError(405, "GET is required");
      send(response, 200, { scenes: catalog.map(({ summary }) => summary) });
      return;
    }
    if (path !== "/api/v4/map-snapshots/query" && path !== "/api/v4/evidence/verify") {
      throw new RequestError(404, "Route not found");
    }
    if (request.method !== "POST") throw new RequestError(405, "POST is required");
    const body = await readObject(request);
    if (path === "/api/v4/evidence/verify") {
      const { hist_event_id, event_revision } = body;
      if (typeof hist_event_id !== "string" || !hist_event_id || hist_event_id.length > 256
          || (event_revision !== undefined && (typeof event_revision !== "string" || !event_revision || event_revision.length > 256))) {
        throw new RequestError(400, "Invalid evidence request");
      }
      if (!allowedEvents.has(hist_event_id)) {
        const rejection: EventEvidenceResult = {
          status: "REJECTED", hist_event_id, issues: [{ gate: "G3", code: "UNVERIFIED_SOURCE",
            entity_id: hist_event_id, message: "此事件未列入当前工作台的史料目录。" }],
        };
        send(response, 200, rejection);
        return;
      }
      const result = await options.evidence.verifyEvent({
        hist_event_id, ...(event_revision === undefined ? {} : { event_revision }),
      });
      send(response, 200, result);
      return;
    }

    const { historical_jdn, revision_id } = body;
    if (typeof historical_jdn !== "number" || !Number.isFinite(historical_jdn)
        || typeof revision_id !== "string" || (revision_id !== "latest" && !UUID_PATTERN.test(revision_id))) {
      throw new RequestError(400, "Invalid snapshot request");
    }
    const registered = catalog.find(({ summary }) =>
      (revision_id === "latest" || summary.revision_id === revision_id.toLowerCase())
      && historical_jdn >= summary.epoch.valid_from_jdn && historical_jdn < summary.epoch.valid_to_jdn);
    if (!registered) throw new RequestError(404, "Scene not found at this historical time");
    const { scene, summary } = registered;
    const snapshot = await readMapSnapshot(options.pool, { historical_jdn, revision_id: summary.revision_id });
    if (!snapshot) throw new RequestError(404, "Scene revision not found");

    const verified = (await Promise.all((scene.event_ids ?? []).map(
      (hist_event_id) => options.evidence.verifyEvent({ hist_event_id }),
    ))).filter((event) => event.status === "VERIFIED");
    const citations = verified.flatMap(({ verified_citations }) => verified_citations.map(({ evidence }) => evidence));
    const citedSources = new Set(citations.map((citation) => citation.source_doc_id));
    const diff = scene.draft_changeset_id
      ? await readMapChangeDiff(options.pool, {
        changeset_id: scene.draft_changeset_id,
        expected_revision_id: snapshot.revision_id,
        historical_jdn,
      })
      : undefined;
    const bundle: EpochSceneBundle = {
      ...(diff?.status === "READY" ? { diff_record: diff.diff } : {}),
      epoch: snapshot.epoch, epoch_label_zh: summary.epoch_label_zh, revision_id: snapshot.revision_id,
      data_status: snapshot.data_status, is_demo_fixture: summary.is_demo_fixture, snapshot,
      historical_year_display: scene.historical_year_display, calendar_era_note: scene.calendar_era_note ?? "",
      default_camera: scene.default_camera,
      canonical_arcs: [], canonical_faces: [],
      admin_units: scene.admin_units ?? [], admin_evolutions: scene.admin_evolutions ?? [],
      toponyms: scene.toponyms ?? [], events: verified.map(({ event }) => event),
      citations_by_id: Object.fromEntries(citations.map((citation) => [citation.citation_id, citation])),
      sources: [...citedSources].flatMap((id) => {
        const source = sourcesById.get(id);
        return source ? [source] : [];
      }),
      polities: scene.polities ?? [], paleo_overlays: scene.paleo_overlays ?? [],
      figures: [], marching_routes: [], modern_reference_overlay: { type: "FeatureCollection", features: [] },
    };
    send(response, 200, bundle);
  }

  return createServer({ maxHeaderSize: 8 * 1024, requestTimeout: 15_000 }, (request, response) => {
    void route(request, response).catch((error: unknown) => {
      if (response.destroyed || response.headersSent) return;
      if (error instanceof RequestError) {
        if (error.statusCode === 413) response.setHeader("Connection", "close");
        send(response, error.statusCode, { error: error.message });
        return;
      }
      send(response, 500, { error: "The studio could not read the requested scene or evidence" });
    });
  });
}
