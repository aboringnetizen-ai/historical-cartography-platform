import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { HistoricalEvent, SourceDocument } from "@historical-cartography/shared-schema";
import { createHistoricalTimestamp } from "@historical-cartography/shared-schema";
import { ScholarEvents } from "@historical-cartography/scholar-agent/events";
import { EvidenceStore } from "@historical-cartography/scholar-agent/evidence";
import type { PrimaryReview } from "@historical-cartography/scholar-agent/evidence";
import { createDraftTopologyRevision, migrateTopology } from "@historical-cartography/topo-core";
import type { Pool } from "pg";
import { createStudioReadApi } from "./studio-read-api.ts";
import type { StudioSceneRegistration } from "./studio-read-api.ts";

export interface StudioProjectFile {
  scholar_database?: string;
  documents?: {
    document: SourceDocument;
    file: string;
    ocr_sidecar?: string;
    printed_pages?: Array<string | null>;
    primary_review?: PrimaryReview;
  }[];
  events?: HistoricalEvent[];
  scenes: StudioSceneRegistration[];
}

export async function loadStudioProject(pool: Pool, projectPath: string) {
  const absolutePath = resolve(projectPath);
  const raw: unknown = JSON.parse(await readFile(absolutePath, "utf8"));
  if (typeof raw !== "object" || raw === null || !("scenes" in raw) || !Array.isArray(raw.scenes)) {
    throw new Error("Invalid studio project file");
  }
  return composeStudioProject(pool, raw as StudioProjectFile, dirname(absolutePath));
}

async function composeStudioProject(pool: Pool, project: StudioProjectFile, base: string) {
  const store = new EvidenceStore();
  const sources: SourceDocument[] = [];
  const indexRevisions = Object.create(null) as Record<string, string>;
  for (const entry of project.documents ?? []) {
    const document = { ...entry.document, local_path: resolve(base, entry.file) };
    if (indexRevisions[document.source_doc_id]) throw new Error("Duplicate source document ID in studio project");
    const index = entry.ocr_sidecar === undefined
      ? await store.indexNativeFile(document, entry.printed_pages, entry.primary_review)
      : await store.indexOcrFile(document, resolve(base, entry.ocr_sidecar), entry.primary_review);
    sources.push(index.document);
    indexRevisions[index.document.source_doc_id] = index.index_revision;
  }

  const scholar = new ScholarEvents(project.scholar_database ? resolve(base, project.scholar_database) : ":memory:", store);
  try {
    for (const event of project.events ?? []) {
      const registration = await scholar.register(event, indexRevisions);
      if (!registration.stored) throw new Error("A configured historical event failed citation verification");
    }
    const server = await createStudioReadApi({ pool, evidence: scholar, scenes: project.scenes, sources });
    return { server, closeEvidence: () => scholar.close() };
  } catch (error) {
    scholar.close();
    throw error;
  }
}

export async function createEngineeringStudioProject(pool: Pool) {
  await migrateTopology(pool);
  const time = createHistoricalTimestamp({ astronomical_year: 1832, month: 1, day: 16 });
  const end = createHistoricalTimestamp({ astronomical_year: 1832, month: 1, day: 17 });
  const epoch = { epoch_id: "studio-engineering-1832",
    valid_from_jdn: time.julian_day_number, valid_to_jdn: end.julian_day_number };
  const existing = await pool.query<{ revision_id: string }>(
    "SELECT revision_id FROM cartography.topology_revisions WHERE epoch_id = $1 ORDER BY recorded_at LIMIT 1", [epoch.epoch_id],
  );
  const revision_id = existing.rows[0]?.revision_id ?? await createDraftTopologyRevision(pool, {
    epoch,
    coverage_boundaries: [{ type: "LineString", coordinates: [[-24, 14.7], [-22.9, 14.7], [-22.9, 15.5], [-24, 15.5], [-24, 14.7]] }],
    internal_boundaries: [{ type: "LineString", coordinates: [[-23.5, 14.7], [-23.5, 15.5]] }],
    faces: [
      { face_id: "engineering-west", polity_id: "engineering-west", zone_semantics: "POLITY_TERRITORY",
        control_score: 30, seed: { type: "Point", coordinates: [-23.8, 15] } },
      { face_id: "engineering-east", polity_id: "engineering-east", zone_semantics: "POLITY_TERRITORY",
        control_score: 80, seed: { type: "Point", coordinates: [-23.2, 15] } },
    ],
  });
  const tier = "T1_PRIMARY_AND_LOCAL_ACADEMIC";
  const eventId = "studio-voyage-port-call";
  const docId = "studio-voyage";
  const fixture = fileURLToPath(new URL("../packages/scholar-agent/fixtures/voyage-excerpt.txt", import.meta.url));
  return composeStudioProject(pool, {
    scenes: [{
      revision_id, sample_jdn: time.julian_day_number, historical_year_display: "1832 年 1 月 16 日",
      epoch_label_zh: "1832 · 工作台联验", default_camera: { center: [-23.45, 15.1], zoom: 7.5 },
      is_demo_fixture: true, calendar_era_note: "工程几何 · 真实地名文献", event_ids: [eventId],
      polities: [
        { polity_id: "engineering-west", name_zh: "工程西区", preferred_hex: "#c87d4c",
          monarch_name: "", era_label: "", summary: "合成几何用于验证共享边界和控制力。" },
        { polity_id: "engineering-east", name_zh: "工程东区", preferred_hex: "#48a6a3",
          monarch_name: "", era_label: "", summary: "合成几何用于验证共享边界和控制力。" },
      ],
    }],
    documents: [{
      file: fixture,
      document: {
        source_doc_id: docId, title: "The Voyage of the Beagle", authors: ["Charles Darwin"],
        is_local_academic_journal: false, medium: "LOCAL_FILE", credibility_tier: tier, language: "en",
        source_url: "https://www.gutenberg.org/ebooks/944", ocr_indexed: false,
      },
      primary_review: {
        file_sha256: "2b22332de5962857216b522f16821c827e9c132252a00b144864368aa1d81b3b",
        basis: "Pinned English transcription, ch. I; witness to a port call and the recorded place name",
      },
    }],
    events: [{
      hist_event_id: eventId, title: "达尔文记载在 Porto Praya 停泊",
      summary: "航行记第一章的停泊记载用于联验原文、日期和出处。", event_category: "OTHER", time_start: time,
      involved_polity_ids: [], involved_figure_ids: [], involved_toponym_ids: [],
      spatial_impact_description: "此段材料支持停泊与地名记载；画面叠加使用工程几何。",
      highest_credibility_tier: tier, conflict_status: "CONSENSUS",
      citations: [{
        citation_id: "studio-voyage-port-call-citation", source_doc_id: docId, credibility_tier: tier,
        page_number: "file:1", ocr_line_range: [1, 2],
        verbatim_quote: "On the 16th of January, 1832, we anchored at Porto Praya", verified_by_human: false,
      }],
    }],
  }, process.cwd());
}
