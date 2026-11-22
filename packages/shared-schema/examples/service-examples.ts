import { createHistoricalTimestamp } from "../src/index.ts";
import type { EventEvidenceResult, MapSnapshot, MapSnapshotRequest } from "../src/index.ts";

// This artificial one-face fixture is for interface integration only.
const start = createHistoricalTimestamp({ astronomical_year: 928 }).julian_day_number;
const end = createHistoricalTimestamp({ astronomical_year: 929 }).julian_day_number;
const coordinates = [[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]];

export const snapshotRequest = {
  historical_jdn: start,
  revision_id: "880a2ba0-dea5-4e96-b642-8407867d7eb6",
} satisfies MapSnapshotRequest;

export const draftSnapshot: MapSnapshot = {
  epoch: { epoch_id: "contract-fixture", valid_from_jdn: start, valid_to_jdn: end },
  revision_id: snapshotRequest.revision_id,
  data_status: "DRAFT",
  territories: {
    type: "FeatureCollection",
    features: [{
      type: "Feature",
      id: "fixture-face",
      geometry: { type: "Polygon", coordinates: [coordinates] },
      properties: {
        face_id: "fixture-face",
        boundary_arc_ids: ["fixture-arc"],
        zone_semantics: "POLITY_TERRITORY",
        control_score: 75,
        polity_id: "fixture-polity",
      },
    }],
  },
  boundaries: {
    type: "FeatureCollection",
    features: [{
      type: "Feature",
      id: "fixture-arc",
      geometry: { type: "LineString", coordinates },
      properties: {
        arc_id: "fixture-arc",
        start_node_id: "fixture-node",
        end_node_id: "fixture-node",
        left_face_id: "fixture-face",
        right_face_id: null,
      },
    }],
  },
};

export const pendingEvidence = {
  status: "PENDING_REVIEW",
  hist_event_id: "fixture-event",
  issues: [{
    gate: "G3",
    code: "PENDING_T1_VERIFICATION",
    entity_id: "fixture-event",
    message: "等待一级史料核验",
  }],
} satisfies EventEvidenceResult;

export const rejectedEvidence = {
  status: "REJECTED",
  hist_event_id: "fixture-event",
  issues: [{
    gate: "G3",
    code: "QUOTE_NOT_FOUND",
    entity_id: "fixture-citation",
    message: "在指定来源和页行中未找到引文",
  }],
} satisfies EventEvidenceResult;
