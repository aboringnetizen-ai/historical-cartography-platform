import {
  pendingEvidence,
  rejectedEvidence,
} from "../../../../shared-schema/examples/service-examples.ts";
import type {
  EventEvidenceReader,
  EventEvidenceRequest,
  EventEvidenceResult,
  MapSnapshot,
  MapSnapshotRequest,
  SharedBoundaryArc,
  TerritorialFace,
  VerifiedCitation,
} from "@historical-cartography/shared-schema";
import {
  DEMO_SCENE_BUNDLES,
  resolveSceneBundleByEpochId,
  resolveSceneBundleByJdn,
} from "../data/demo-dataset.ts";
import type { EpochSceneBundle, PolityMetadata } from "../data/demo-types.ts";
import { jdnToHistoricalParts } from "../director/timeline-math.ts";

export type SnapshotLoadStatus = "LOADING" | "READY" | "NO_DATA" | "ERROR";

export interface SnapshotQueryOutcome {
  status: SnapshotLoadStatus;
  request_seq: number;
  request: MapSnapshotRequest;
  stale_discarded: boolean;
  bundle?: EpochSceneBundle;
  snapshot?: MapSnapshot;
  is_demo_data: boolean;
  error_message?: string;
}

export interface SnapshotTransport {
  fetchSnapshot(request: MapSnapshotRequest): Promise<EpochSceneBundle | undefined>;
  fetchEventEvidence(request: EventEvidenceRequest): Promise<EventEvidenceResult>;
}

/**
 * Adapt a canonical frozen `MapSnapshot` from `topo-core` HTTP/RPC into an `EpochSceneBundle`
 * without requiring backend services to know about frontend presentation state.
 */
export function adaptMapSnapshotToSceneBundle(raw: EpochSceneBundle | MapSnapshot): EpochSceneBundle {
  if ("snapshot" in raw && "canonical_arcs" in raw) {
    return raw;
  }
  const snap = raw as MapSnapshot;
  let minLon = Infinity;
  let maxLon = -Infinity;
  let minLat = Infinity;
  let maxLat = -Infinity;
  const polityIds = new Set<string>();

  const canonicalFaces: TerritorialFace[] = snap.territories.features.map((feat) => {
    const pid = feat.properties.polity_id;
    if (pid) polityIds.add(pid);
    for (const pt of feat.geometry.coordinates[0] ?? []) {
      const lon = pt[0] ?? 0;
      const lat = pt[1] ?? 0;
      if (lon < minLon) minLon = lon;
      if (lon > maxLon) maxLon = lon;
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
    }
    return {
      face_id: feat.properties.face_id,
      epoch_id: snap.epoch.epoch_id,
      boundary_arc_ids: feat.properties.boundary_arc_ids,
      zone_semantics: feat.properties.zone_semantics,
      ...(pid !== undefined ? { polity_id: pid } : {}),
      control_score: feat.properties.control_score,
      valid_from_jdn: snap.epoch.valid_from_jdn,
      valid_to_jdn: snap.epoch.valid_to_jdn,
      highest_credibility_tier: "T1_PRIMARY_AND_LOCAL_ACADEMIC",
      driven_by_event_ids: [],
      human_locked_override: false,
    };
  });

  const canonicalArcs: SharedBoundaryArc[] = snap.boundaries.features.map((b) => ({
    arc_id: b.properties.arc_id,
    epoch_id: snap.epoch.epoch_id,
    canonical_geometry: b.geometry,
    smoothness_profile_id: "profile-cartographic-natural",
    start_node_id: b.properties.start_node_id,
    end_node_id: b.properties.end_node_id,
    left_face_id: b.properties.left_face_id ?? "EXTERIOR_WORLD",
    right_face_id: b.properties.right_face_id ?? "EXTERIOR_WORLD",
    certainty: "CERTAIN_EXACT",
    valid_from_jdn: snap.epoch.valid_from_jdn,
    valid_to_jdn: snap.epoch.valid_to_jdn,
    driven_by_event_ids: [],
    human_locked_override: false,
  }));

  const parts = jdnToHistoricalParts(snap.epoch.valid_from_jdn);
  const center: [number, number] = Number.isFinite(minLon) && Number.isFinite(minLat)
    ? [(minLon + maxLon) / 2, (minLat + maxLat) / 2]
    : [62.0, 38.0];
  const polities: PolityMetadata[] = Array.from(polityIds).map((pid) => ({
    polity_id: pid,
    name_zh: pid,
    preferred_hex: "#3b82f6",
    monarch_name: "服务端政权数据",
    era_label: parts.historical_year_display,
    summary: `来自后端 topo-core 快照 (${snap.revision_id})`,
  }));

  return {
    epoch: snap.epoch,
    epoch_label_zh: `${parts.historical_year_display} · ${snap.epoch.epoch_id}`,
    historical_year_display: parts.historical_year_display,
    calendar_era_note: `epoch=${snap.epoch.epoch_id}`,
    revision_id: snap.revision_id,
    data_status: snap.data_status,
    is_demo_fixture: false,
    canonical_arcs: canonicalArcs,
    canonical_faces: canonicalFaces,
    snapshot: snap,
    admin_units: [],
    admin_evolutions: [],
    toponyms: [],
    events: [],
    sources: [],
    citations_by_id: {},
    figures: [],
    paleo_overlays: [],
    marching_routes: [],
    polities,
    default_camera: { center, zoom: 4.5 },
    modern_reference_overlay: { type: "FeatureCollection", features: [] },
  };
}

export class DemoSnapshotTransport implements SnapshotTransport {
  private readonly simulatedDelayMsByEpoch: Map<string, number>;
  private readonly forcedErrorEpochs: Set<string>;

  constructor(options?: {
    simulatedDelayMsByEpoch?: Record<string, number>;
    forcedErrorEpochs?: string[];
  }) {
    this.simulatedDelayMsByEpoch = new Map(Object.entries(options?.simulatedDelayMsByEpoch ?? {}));
    this.forcedErrorEpochs = new Set(options?.forcedErrorEpochs ?? []);
  }

  async fetchSnapshot(request: MapSnapshotRequest): Promise<EpochSceneBundle | undefined> {
    if (request.revision_id !== "latest") {
      for (const b of DEMO_SCENE_BUNDLES) {
        if (b.snapshot.revision_id === request.revision_id) return b;
        if (b.diff_record?.before_snapshot.revision_id === request.revision_id) {
          return {
            ...b,
            revision_id: b.diff_record.before_snapshot.revision_id,
            data_status: b.diff_record.before_snapshot.data_status,
            snapshot: b.diff_record.before_snapshot,
          };
        }
        if (b.diff_record?.after_snapshot.revision_id === request.revision_id) {
          return {
            ...b,
            revision_id: b.diff_record.after_snapshot.revision_id,
            data_status: b.diff_record.after_snapshot.data_status,
            snapshot: b.diff_record.after_snapshot,
          };
        }
      }
      if (request.revision_id === "880a2ba0-dea5-4e96-b642-8407867d7eb6") {
        return resolveSceneBundleByEpochId("contract-fixture");
      }
    }

    const matched = resolveSceneBundleByJdn(request.historical_jdn);
    const delay = matched ? (this.simulatedDelayMsByEpoch.get(matched.epoch.epoch_id) ?? 0) : 0;
    if (delay > 0) {
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
    if (matched && this.forcedErrorEpochs.has(matched.epoch.epoch_id)) {
      throw new Error(`模拟后端快照异常：${matched.epoch.epoch_id}`);
    }
    return matched;
  }

  async fetchEventEvidence(request: EventEvidenceRequest): Promise<EventEvidenceResult> {
    if (request.hist_event_id === "fixture-event-rejected") return rejectedEvidence;
    if (request.hist_event_id === "fixture-event") return pendingEvidence;

    for (const bundle of DEMO_SCENE_BUNDLES) {
      const event = bundle.events.find((item) => item.hist_event_id === request.hist_event_id);
      if (!event) continue;

      if (event.conflict_status === "PENDING_T1_VERIFICATION") {
        return {
          status: "PENDING_REVIEW",
          hist_event_id: event.hist_event_id,
          issues: [
            {
              gate: "G3",
              code: "PENDING_T1_VERIFICATION",
              entity_id: event.hist_event_id,
              message: "该事件当前仅依赖 T3 百科线索，需溯源至 T1 一手史料后方可触发边界变更。",
            },
          ],
        };
      }

      if (event.conflict_status === "T1_SCHOLARLY_DISPUTE") {
        return {
          status: "PENDING_REVIEW",
          hist_event_id: event.hist_event_id,
          issues: [
            {
              gate: "G4",
              code: "T1_SCHOLARLY_DISPUTE",
              entity_id: event.hist_event_id,
              message: "存在多方一级史料/钱币考证分歧，已保留双方原文引证等待人工仲裁。",
            },
          ],
        };
      }

      const verified: VerifiedCitation[] = event.citations.map((cit) => ({
        citation_id: cit.citation_id,
        source_doc_id: cit.source_doc_id,
        index_revision: request.event_revision ?? `idx-${bundle.revision_id}`,
        evidence: cit,
      }));
      return {
        status: "VERIFIED",
        event_revision: request.event_revision ?? `ev-${bundle.revision_id}`,
        event,
        verified_citations: verified,
      };
    }

    return {
      status: "REJECTED",
      hist_event_id: request.hist_event_id,
      issues: [
        {
          gate: "G3",
          code: "QUOTE_NOT_FOUND",
          entity_id: request.hist_event_id,
          message: "未在当前文献索引版本中找到对应事件与核验引文。",
        },
      ],
    };
  }
}

export class HttpSnapshotTransport implements SnapshotTransport {
  private readonly baseUrl: string;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
  }

  async fetchSnapshot(request: MapSnapshotRequest): Promise<EpochSceneBundle | undefined> {
    const res = await fetch(`${this.baseUrl}/api/v4/map-snapshots/query`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
    });
    if (res.status === 404) return undefined;
    if (!res.ok) throw new Error(`HTTP ${res.status} fetching snapshot`);
    const payload = (await res.json()) as EpochSceneBundle | MapSnapshot;
    return adaptMapSnapshotToSceneBundle(payload);
  }

  async fetchEventEvidence(request: EventEvidenceRequest): Promise<EventEvidenceResult> {
    const res = await fetch(`${this.baseUrl}/api/v4/evidence/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} verifying event evidence`);
    return (await res.json()) as EventEvidenceResult;
  }
}

/**
 * Snapshot & evidence coordinator with strict monotonic request-sequence stale guard.
 */
export class MapSnapshotClient implements EventEvidenceReader {
  private readonly transport: SnapshotTransport;
  private latestIssuedSeq = 0;
  private latestCommittedSeq = 0;

  constructor(transport: SnapshotTransport = new DemoSnapshotTransport()) {
    this.transport = transport;
  }

  getLatestIssuedSeq(): number {
    return this.latestIssuedSeq;
  }

  async loadSnapshot(request: MapSnapshotRequest): Promise<SnapshotQueryOutcome> {
    const seq = ++this.latestIssuedSeq;
    try {
      const bundle = await this.transport.fetchSnapshot(request);
      if (seq < this.latestIssuedSeq) {
        return {
          status: "READY",
          request_seq: seq,
          request,
          stale_discarded: true,
          is_demo_data: bundle?.is_demo_fixture ?? true,
        };
      }
      this.latestCommittedSeq = seq;
      if (!bundle) {
        return {
          status: "NO_DATA",
          request_seq: seq,
          request,
          stale_discarded: false,
          is_demo_data: false,
          error_message: `历史时刻 JDN ${request.historical_jdn.toFixed(2)} 暂无已编入的时空拓扑切片。`,
        };
      }
      return {
        status: "READY",
        request_seq: seq,
        request,
        stale_discarded: false,
        bundle,
        snapshot: bundle.snapshot,
        is_demo_data: bundle.is_demo_fixture,
      };
    } catch (error) {
      if (seq < this.latestIssuedSeq) {
        return {
          status: "ERROR",
          request_seq: seq,
          request,
          stale_discarded: true,
          is_demo_data: false,
          error_message: error instanceof Error ? error.message : String(error),
        };
      }
      this.latestCommittedSeq = seq;
      return {
        status: "ERROR",
        request_seq: seq,
        request,
        stale_discarded: false,
        is_demo_data: false,
        error_message: error instanceof Error ? error.message : String(error),
      };
    }
  }

  getLatestCommittedSeq(): number {
    return this.latestCommittedSeq;
  }

  verifyEvent(request: EventEvidenceRequest): Promise<EventEvidenceResult> {
    return this.transport.fetchEventEvidence(request);
  }
}
