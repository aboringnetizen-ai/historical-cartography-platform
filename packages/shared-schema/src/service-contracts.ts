import type { FeatureCollection, LineString, Polygon } from "geojson";
import type { EvidenceCitation, HistoricalEvent, TerritorialFace } from "./canonical.ts";
import type { GateIssue } from "./gates.ts";

// Service read models. Canonical entities and their persistence fields live in canonical.ts.
export interface EpochRange {
  epoch_id: string;
  valid_from_jdn: number;
  valid_to_jdn: number;
}

export type MapFaceProperties = Pick<TerritorialFace,
  "face_id" | "boundary_arc_ids" | "control_score" | "zone_semantics" | "polity_id"
>;

export interface MapBoundaryProperties {
  arc_id: string;
  start_node_id: string;
  end_node_id: string;
  left_face_id: string | null;
  right_face_id: string | null;
  snapped_paleo_feature_id?: string;
}

export interface MapSnapshotRequest {
  revision_id: string;
  historical_jdn: number;
}

export interface MapSnapshot {
  epoch: EpochRange;
  revision_id: string;
  data_status: "DRAFT" | "COMMITTED";
  territories: FeatureCollection<Polygon, MapFaceProperties>;
  boundaries: FeatureCollection<LineString, MapBoundaryProperties>;
}

export interface EventEvidenceRequest {
  hist_event_id: string;
  event_revision?: string;
}

export interface VerifiedCitation {
  citation_id: EvidenceCitation["citation_id"];
  source_doc_id: EvidenceCitation["source_doc_id"];
  index_revision: string;
  evidence: EvidenceCitation;
}

export type EventEvidenceResult =
  | {
    status: "VERIFIED";
    event_revision: string;
    event: HistoricalEvent;
    verified_citations: VerifiedCitation[];
  }
  | {
    status: "PENDING_REVIEW" | "REJECTED";
    hist_event_id: string;
    issues: readonly GateIssue[];
  };

export interface EventEvidenceReader {
  verifyEvent(request: EventEvidenceRequest): Promise<EventEvidenceResult>;
}
