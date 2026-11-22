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
  VerifiedCitation,
} from "@historical-cartography/shared-schema";
import {
  DEMO_SCENE_BUNDLES,
  resolveSceneBundleByEpochId,
  resolveSceneBundleByJdn,
} from "../data/demo-dataset.ts";
import type { EpochSceneBundle } from "../data/demo-types.ts";

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

export class DemoSnapshotTransport implements SnapshotTransport {
  private readonly simulatedDelayMsByEpoch: Map<string, number>;
  private readonly forcedErrorEpochs: Set<string>;

  constructor(options?: {
    simulatedDelayMsByEpoch?: Record<string, number>;
    forcedErrorEpochs?: string[];
  }) {
    this.simulatedDelayMsByEpoch = new Map(
      Object.entries(options?.simulatedDelayMsByEpoch ?? {}),
    );
    this.forcedErrorEpochs = new Set(options?.forcedErrorEpochs ?? []);
  }

  async fetchSnapshot(request: MapSnapshotRequest): Promise<EpochSceneBundle | undefined> {
    if (request.revision_id === "880a2ba0-dea5-4e96-b642-8407867d7eb6") {
      return resolveSceneBundleByEpochId("contract-fixture");
    }
    const matched = resolveSceneBundleByJdn(request.historical_jdn);
    const delay = matched ? (this.simulatedDelayMsByEpoch.get(matched.epoch.epoch_id) ?? 0) : 0;
    if (delay > 0) {
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
    if (matched && this.forcedErrorEpochs.has(matched.epoch.epoch_id)) {
      throw new Error(`模拟后端快照异常：${matched.epoch.epoch_id}`);
    }
    if (request.revision_id.startsWith("rev-") && matched && request.revision_id === "rev-928-before-001" && matched.diff_record) {
      return {
        ...matched,
        revision_id: matched.diff_record.before_snapshot.revision_id,
        data_status: matched.diff_record.before_snapshot.data_status,
        snapshot: matched.diff_record.before_snapshot,
      };
    }
    return matched;
  }

  async fetchEventEvidence(request: EventEvidenceRequest): Promise<EventEvidenceResult> {
    if (request.hist_event_id === "fixture-event-rejected") {
      return rejectedEvidence;
    }
    if (request.hist_event_id === "fixture-event") {
      return pendingEvidence;
    }

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
        index_revision: request.event_revision ?? "idx-v4-928-001",
        evidence: cit,
      }));
      return {
        status: "VERIFIED",
        event_revision: request.event_revision ?? "ev-rev-928-001",
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
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} fetching snapshot`);
    }
    return (await res.json()) as EpochSceneBundle;
  }

  async fetchEventEvidence(request: EventEvidenceRequest): Promise<EventEvidenceResult> {
    const res = await fetch(`${this.baseUrl}/api/v4/evidence/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} verifying event evidence`);
    }
    return (await res.json()) as EventEvidenceResult;
  }
}

/**
 * Snapshot & evidence coordinator with strict monotonic request-sequence stale guard.
 * Ensures out-of-order responses from slower queries NEVER overwrite newer timestamps.
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
