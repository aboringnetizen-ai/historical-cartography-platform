import type { FeatureCollection, LineString, Polygon } from "geojson";
import type { EvidenceCitation, HistoricalEvent, SpatialChangeSet, TerritorialFace } from "./canonical.ts";
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

export interface OpenMapChangeSetRequest {
  changeset_id: string;
  base_revision_id: string;
  epoch_id: string;
  branch_name: string;
  author_type: SpatialChangeSet["author_type"];
  author_id: string;
  bound_event_ids: readonly string[];
}

export interface BoundEventRevision {
  hist_event_id: string;
  event_revision: string;
  citation_indexes: Array<Pick<VerifiedCitation, "citation_id" | "source_doc_id" | "index_revision">>;
}

export type OpenMapChangeSetResult =
  | {
    status: "OPENED";
    changeset: SpatialChangeSet;
    base_revision_id: string;
    bound_events: BoundEventRevision[];
    issues: readonly GateIssue[];
  }
  | { status: "REJECTED"; issues: readonly GateIssue[] };

export interface ReassignBaseUnitsRequest {
  changeset_id: string;
  operation_id: string;
  expected_revision_id: string;
  driven_by_event_ids: readonly string[];
  assignments: ReadonlyArray<{ face_id: string; polity_id: string | null; control_score: number }>;
}

export interface DraftUnitOperation {
  operation_id: string;
  changeset_id: string;
  previous_revision_id: string;
  revision_id: string;
  moved_face_ids: string[];
  affected_arc_ids: string[];
  driven_by_event_ids: string[];
  status: "APPLIED" | "ROLLED_BACK";
}

export interface MapChangeDraft {
  revision_id: string;
  operations: DraftUnitOperation[];
}

export interface MapChangeEvidenceCheck {
  status: "CURRENT" | "BLOCKED";
  bound_events: BoundEventRevision[];
  issues: readonly GateIssue[];
}
