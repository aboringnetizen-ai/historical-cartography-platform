export const CANONICAL_SCHEMA_VERSION = "4.0" as const;

export const GATE_IDS = ["G1", "G1.5", "G2", "G3", "G4", "G5"] as const;
export type GateId = (typeof GATE_IDS)[number];

export type GateIssueCode =
  | "INVALID_TOPOLOGY"
  | "PALEOGEOGRAPHY_MISMATCH"
  | "INVALID_BOUNDARY_SMOOTHNESS"
  | "TOPONYM_FACE_CHANGED"
  | "EVENT_REQUIRED"
  | "UNVERIFIED_SOURCE"
  | "QUOTE_NOT_FOUND"
  | "PENDING_T1_VERIFICATION"
  | "HUMAN_LOCKED"
  | "T1_SCHOLARLY_DISPUTE"
  | "LABEL_COLLISION"
  | "FRAME_NOT_READY"
  | "HUD_SAFE_AREA_VIOLATION";

export interface GateIssue {
  gate: GateId;
  code: GateIssueCode;
  entity_id?: string;
  message: string;
}

export interface GateResult {
  gate: GateId;
  passed: boolean;
  issues: readonly GateIssue[];
}
