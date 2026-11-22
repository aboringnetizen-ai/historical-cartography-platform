import { useEffect, useState } from "react";
import type {
  EventEvidenceResult,
  HistoricalEvent,
  HistoricalToponym,
  SpatialChangeSet,
} from "@historical-cartography/shared-schema";
import type { EpochSceneBundle } from "../core/data/demo-types.ts";
import { formatTimestampWithPrecision } from "../core/director/timeline-math.ts";
import type { MapSnapshotClient } from "../core/services/snapshot-client.ts";

export interface EvidenceDiffDrawerProps {
  bundle: EpochSceneBundle;
  snapshotClient: MapSnapshotClient;
  selectedFaceId?: string | undefined;
  selectedArcId?: string | undefined;
  selectedPolityId?: string | undefined;
  spotlightPolityId?: string | undefined;
  selectedToponym?: HistoricalToponym | undefined;
  selectedEventId?: string | undefined;
  diffPreviewMode: "AFTER" | "BEFORE";
  onChangeDiffPreviewMode: (mode: "AFTER" | "BEFORE") => void;
  onEnableDiffCurtain: () => void;
  onSelectEvent: (eventId: string) => void;
  onToggleSpotlightPolity: (polityId: string) => void;
  onToggleLockFace: (faceId: string) => void;
  onToggleLockArc: (arcId: string) => void;
  onReviewChangeset: (status: SpatialChangeSet["status"]) => void;
  onArbitrateEvent: (eventId: string, nextStatus: HistoricalEvent["conflict_status"]) => void;
  onFlyToCoords: (coords: [number, number], zoom?: number) => void;
  onClose: () => void;
}

export function EvidenceDiffDrawer(props: EvidenceDiffDrawerProps) {
  const [evidenceResult, setEvidenceResult] = useState<EventEvidenceResult | null>(null);
  const [overrideEventId, setOverrideEventId] = useState<string | null>(null);

  const activeEventId =
    overrideEventId
    ?? props.selectedEventId
    ?? props.bundle.events[0]?.hist_event_id;

  useEffect(() => {
    setOverrideEventId(null);
  }, [props.selectedEventId, props.bundle.epoch.epoch_id]);

  useEffect(() => {
    if (!activeEventId) {
      setEvidenceResult(null);
      return;
    }
    let cancelled = false;
    void props.snapshotClient
      .verifyEvent({ hist_event_id: activeEventId, event_revision: props.bundle.revision_id })
      .then((res) => {
        if (!cancelled) setEvidenceResult(res);
      });
    return () => {
      cancelled = true;
    };
  }, [activeEventId, props.bundle.revision_id, props.snapshotClient]);

  const selectedFace = props.bundle.canonical_faces.find((f) => f.face_id === props.selectedFaceId);
  const selectedArc = props.bundle.canonical_arcs.find((a) => a.arc_id === props.selectedArcId);
  const resolvedPolityId = props.selectedPolityId ?? selectedFace?.polity_id;
  const selectedPolity = props.bundle.polities.find((p) => p.polity_id === resolvedPolityId);
  const activeEvent = props.bundle.events.find((e) => e.hist_event_id === activeEventId);

  const adminUnits = props.bundle.admin_units.filter((u) =>
    resolvedPolityId ? u.polity_id === resolvedPolityId : true,
  );
  const adminSorted = [...adminUnits].sort((a, b) => a.admin_level - b.admin_level);

  const matchingEvolutions = props.selectedToponym
    ? props.bundle.admin_evolutions.filter((evo) => {
        const linkedUnitIds = new Set(
          props.bundle.admin_units
            .filter((u) => u.seat_toponym_id === props.selectedToponym?.toponym_id)
            .map((u) => u.admin_unit_id),
        );
        return (
          evo.source_admin_unit_ids.some((id) => linkedUnitIds.has(id))
          || evo.target_admin_unit_ids.some((id) => linkedUnitIds.has(id))
        );
      })
    : [];

  const toponymEvolutions = matchingEvolutions.length > 0 ? matchingEvolutions : props.bundle.admin_evolutions;

  return (
    <aside className="side-drawer right" aria-label="考证原文与变更差异抽屉">
      <div className="panel-section">
        <div className="panel-title">
          <span>拓扑考证、政区沿革与差异审查</span>
          <button type="button" className="studio-btn" style={{ padding: "2px 8px" }} onClick={props.onClose}>
            ✕
          </button>
        </div>

        {/* Selected Polity & G4 Face Lock + Decoupled Spotlight */}
        {selectedPolity && (
          <div style={{ fontSize: 12, lineHeight: 1.55, marginBottom: 8, paddingBottom: 8, borderBottom: "1px solid var(--border-subtle)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 6 }}>
              <strong style={{ fontSize: 14 }}>
                {selectedPolity.emblem_symbol ?? ""} {selectedPolity.name_zh}
              </strong>
              <span className="badge-pill badge-t1">{selectedPolity.era_label}</span>
            </div>
            <div style={{ color: "#94a3b8" }}>君主/执政：{selectedPolity.monarch_name}</div>
            <div>{selectedPolity.summary}</div>
            <div style={{ display: "flex", gap: 6, marginTop: 6, flexWrap: "wrap" }}>
              <button
                type="button"
                className={`studio-btn ${props.spotlightPolityId === selectedPolity.polity_id ? "active" : ""}`}
                style={{ padding: "3px 8px", fontSize: 11 }}
                onClick={() => props.onToggleSpotlightPolity(selectedPolity.polity_id)}
              >
                {props.spotlightPolityId === selectedPolity.polity_id ? "取消聚光灯聚焦" : "聚光灯聚焦此政权"}
              </button>
              {selectedFace && (
                <button
                  type="button"
                  className={`studio-btn ${selectedFace.human_locked_override ? "warn" : ""}`}
                  style={{ padding: "3px 8px", fontSize: 11 }}
                  onClick={() => props.onToggleLockFace(selectedFace.face_id)}
                >
                  {selectedFace.human_locked_override ? "🔒 解锁政权面 (G4)" : "🔓 锁定政权面 (G4)"}
                </button>
              )}
            </div>
          </div>
        )}

        {/* Selected Shared Boundary Arc Card */}
        {selectedArc && (
          <div className="quote-box" style={{ marginBottom: 8, borderLeftColor: "#38bdf8" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <strong>共享疆界弧段 · {selectedArc.arc_id}</strong>
              <span className={`badge-pill ${selectedArc.human_locked_override ? "badge-dispute" : "badge-t1"}`}>
                {selectedArc.certainty}
              </span>
            </div>
            <div style={{ fontSize: 11, color: "#cbd5e1", marginTop: 4 }}>
              分形维度 D = {selectedArc.measured_fractal_dim?.toFixed(3) ?? "—"} · Hausdorff 偏离 ={" "}
              {selectedArc.measured_max_deviation_km?.toFixed(2) ?? "—"} km
            </div>
            {selectedArc.snapped_paleo_feature_id && (
              <div style={{ fontSize: 11, color: "#93c5fd" }}>吸附古水系/特征：{selectedArc.snapped_paleo_feature_id}</div>
            )}
            <div style={{ display: "flex", gap: 6, marginTop: 6, flexWrap: "wrap" }}>
              <button
                type="button"
                className={`studio-btn ${selectedArc.human_locked_override ? "warn" : ""}`}
                style={{ padding: "2px 8px", fontSize: 10 }}
                onClick={() => props.onToggleLockArc(selectedArc.arc_id)}
              >
                {selectedArc.human_locked_override ? "🔒 解锁弧段 (G4)" : "🔓 锁定此边界弧段 (G4)"}
              </button>
              {selectedArc.driven_by_event_ids.map((eid) => (
                <button
                  key={eid}
                  type="button"
                  className="studio-btn"
                  style={{ padding: "2px 7px", fontSize: 10 }}
                  onClick={() => {
                    setOverrideEventId(eid);
                    props.onSelectEvent(eid);
                  }}
                >
                  溯源事件 {eid}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Selected Toponym + Admin Evolution + Direct Citations */}
        {props.selectedToponym && (
          <div style={{ fontSize: 12, paddingTop: 4, borderTop: "1px solid var(--border-subtle)" }}>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <strong>
                地名考证：{props.selectedToponym.name_zh}
                {props.selectedToponym.name_original_script ? ` (${props.selectedToponym.name_original_script})` : ""}
              </strong>
              <span className="pill-badge">{props.selectedToponym.location_precision}</span>
            </div>
            <div style={{ color: "#94a3b8", fontSize: 11 }}>
              今属：{props.selectedToponym.modern_name ?? "考证中"} · 别名/译写：
              {props.selectedToponym.alt_names_and_transliterations.join(" / ") || "无"}
            </div>
            {props.selectedToponym.citations.map((cit) => (
              <div key={cit.citation_id} className="quote-box" style={{ marginTop: 6 }}>
                <div style={{ fontSize: 10.5, color: "#94a3b8" }}>
                  地名文献：{cit.source_doc_id} · {cit.volume_or_chapter ?? ""} {cit.page_number ?? ""}
                </div>
                <div>“{cit.verbatim_quote}”</div>
              </div>
            ))}
            {toponymEvolutions.length > 0 && (
              <div style={{ marginTop: 6, fontSize: 11 }}>
                <div style={{ color: "#cbd5e1", fontWeight: 600 }}>关联政区沿革 ({toponymEvolutions.length})：</div>
                {toponymEvolutions.slice(0, 4).map((evo) => (
                  <div key={evo.evolution_id} style={{ color: "#94a3b8", marginTop: 2 }}>
                    • [{evo.change_type}] {evo.timestamp.historical_year_display} — {evo.target_admin_unit_ids.join(", ")}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* 0–3 Tier AdminUnit Hierarchy Tree */}
      {adminSorted.length > 0 && (
        <div className="panel-section">
          <div className="panel-title">0–3 级建制层级树 ({adminSorted.length})</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 11.5 }}>
            {adminSorted.map((unit) => {
              const seat = props.bundle.toponyms.find((t) => t.toponym_id === unit.seat_toponym_id);
              return (
                <div
                  key={unit.admin_unit_id}
                  style={{
                    marginLeft: unit.admin_level * 12,
                    padding: "4px 7px",
                    borderLeft: "2px solid rgba(56, 189, 248, 0.45)",
                    background: "rgba(30, 41, 59, 0.55)",
                    borderRadius: 4,
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    gap: 6,
                  }}
                >
                  <div>
                    <span style={{ color: "#fbbf24", marginRight: 5 }}>L{unit.admin_level}</span>
                    <strong>{unit.name_historical}</strong>
                    {unit.alt_names.length > 0 && (
                      <span style={{ color: "#94a3b8", marginLeft: 5 }}>({unit.alt_names[0]})</span>
                    )}
                  </div>
                  {seat && (
                    <button
                      type="button"
                      className="studio-btn"
                      style={{ padding: "1px 6px", fontSize: 10 }}
                      onClick={() => props.onFlyToCoords(seat.coordinates, 6.2)}
                    >
                      定位{seat.name_zh}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Historical Event Citations, Sources & Scholarly Dispute Arbitration */}
      <div className="panel-section">
        <div className="panel-title">
          <span>史料引文与 G3/T1 门禁</span>
          {activeEvent && (
            <span className={`badge-pill ${activeEvent.conflict_status === "T1_SCHOLARLY_DISPUTE" ? "badge-dispute" : "badge-t1"}`}>
              {activeEvent.conflict_status}
            </span>
          )}
        </div>

        <select
          aria-label="选择事件查看史料"
          className="studio-select"
          value={activeEventId ?? ""}
          onChange={(e) => {
            setOverrideEventId(e.target.value);
            props.onSelectEvent(e.target.value);
          }}
        >
          {props.bundle.events.map((ev) => (
            <option key={ev.hist_event_id} value={ev.hist_event_id}>
              {ev.title} ({ev.time_start.historical_year_display})
            </option>
          ))}
        </select>

        {activeEvent && (
          <div style={{ marginTop: 8, fontSize: 12, lineHeight: 1.55 }}>
            <div style={{ fontWeight: 700, color: "#f8fafc" }}>{activeEvent.title}</div>
            <div style={{ fontSize: 11, color: "#fbbf24" }}>{formatTimestampWithPrecision(activeEvent.time_start)}</div>
            <p style={{ margin: "4px 0", color: "#cbd5e1" }}>{activeEvent.spatial_impact_description}</p>
            {activeEvent.conflict_status === "T1_SCHOLARLY_DISPUTE" && (
              <div style={{ display: "flex", gap: 6, marginBottom: 6 }}>
                <button
                  type="button"
                  className="studio-btn primary"
                  style={{ padding: "3px 8px", fontSize: 10 }}
                  onClick={() => props.onArbitrateEvent(activeEvent.hist_event_id, "CONSENSUS")}
                >
                  采纳T1共识并结案
                </button>
              </div>
            )}
          </div>
        )}

        {evidenceResult?.status === "PENDING_REVIEW" && evidenceResult.issues.length > 0 && (
          <div className="quote-box" style={{ marginTop: 6, borderLeftColor: "#f59e0b", background: "rgba(120, 53, 15, 0.25)" }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: "#fbbf24" }}>
              待 T1 学术核查 / 门禁提醒 ({activeEvent?.highest_credibility_tier ?? "T3_GENERAL_ENCYCLOPEDIA"})
            </div>
            {evidenceResult.issues.map((iss, idx) => (
              <div key={`${iss.code}-${idx}`} style={{ fontSize: 11, color: "#fde68a", marginTop: 2 }}>
                [{iss.gate}/{iss.code}] {iss.message}
              </div>
            ))}
          </div>
        )}

        {(evidenceResult?.status === "VERIFIED" || (activeEvent && activeEvent.citations.length > 0)) && (
          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 6 }}>
            {(evidenceResult?.status === "VERIFIED"
              ? evidenceResult.verified_citations.map((vc) => ({
                  citation: vc.evidence,
                  source_doc_id: vc.source_doc_id,
                  is_verified: true,
                }))
              : (activeEvent?.citations ?? []).map((cit) => ({
                  citation: cit,
                  source_doc_id: cit.source_doc_id,
                  is_verified: false,
                }))
            ).map(({ citation, source_doc_id, is_verified }) => {
              const doc = props.bundle.sources.find((s) => s.source_doc_id === source_doc_id);
              const targetUrl = doc?.archive_snapshot_url ?? doc?.source_url;
              return (
                <div key={citation.citation_id} className="quote-box">
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3, gap: 6 }}>
                    <strong style={{ fontSize: 11, color: is_verified ? "#34d399" : "#fbbf24" }}>
                      {doc?.title ?? source_doc_id} ({doc?.medium ?? "ENCYCLOPEDIA"})
                    </strong>
                    <span className="pill-badge">
                      {citation.credibility_tier}
                      {citation.quote_match_score !== undefined
                        ? ` · ${Math.round(citation.quote_match_score * 100)}%`
                        : ""}
                    </span>
                  </div>
                  <div style={{ fontSize: 11, color: "#f8fafc" }}>“{citation.verbatim_quote}”</div>
                  <div style={{ fontSize: 10, color: "#94a3b8", marginTop: 4, display: "flex", flexWrap: "wrap", gap: 8 }}>
                    <span>
                      {citation.volume_or_chapter ?? citation.web_section_anchor ?? ""} {citation.page_number ?? ""}
                    </span>
                    {citation.ocr_line_range && (
                      <span>
                        [{doc?.ocr_engine ?? "OCR"} L{citation.ocr_line_range[0]}–{citation.ocr_line_range[1]}]
                      </span>
                    )}
                    <span>{citation.verified_by_human ? "✓ 人工复核" : "维基测试底稿 · 待 T1 核查"}</span>
                    {targetUrl && (
                      <a
                        href={targetUrl}
                        target="_blank"
                        rel="noreferrer"
                        style={{ color: "#38bdf8", textDecoration: "underline" }}
                      >
                        来源条目 {doc?.medium === "ENCYCLOPEDIA" ? "(Wikipedia)" : "原件快照"} ↗
                      </a>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Changeset Diff & Human Approval */}
      {props.bundle.diff_record && (
        <div className="panel-section">
          <div className="panel-title">
            <span>空间变更集与人工审定</span>
            <span className={`badge-pill ${props.bundle.diff_record.changeset.status === "COMMITTED" ? "badge-committed" : "badge-draft"}`}>
              {props.bundle.diff_record.changeset.status}
            </span>
          </div>
          <div style={{ fontSize: 11.5, color: "#cbd5e1", lineHeight: 1.5, marginBottom: 8 }}>
            <div>分支：{props.bundle.diff_record.changeset.branch_name}</div>
            <div>{props.bundle.diff_record.summary_zh}</div>
            <div style={{ color: "#93c5fd", marginTop: 3 }}>
              影响弧段：{props.bundle.diff_record.affected_arc_ids.length} 条 · 波及地名：
              {props.bundle.diff_record.affected_toponym_ids.length} 处
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 4 }}>
              {props.bundle.diff_record.affected_arc_ids.slice(0, 10).map((aid) => (
                <code
                  key={aid}
                  style={{
                    fontSize: 10,
                    padding: "1px 5px",
                    borderRadius: 4,
                    background: "rgba(56, 189, 248, 0.14)",
                    color: "#7dd3fc",
                    border: "1px solid rgba(56, 189, 248, 0.28)",
                  }}
                >
                  {aid}
                </code>
              ))}
              {props.bundle.diff_record.affected_arc_ids.length > 10 && (
                <span style={{ fontSize: 10, color: "#94a3b8" }}>
                  +{props.bundle.diff_record.affected_arc_ids.length - 10} 条
                </span>
              )}
            </div>
          </div>

          <div className="grid-two">
            <button
              type="button"
              className={`studio-btn ${props.diffPreviewMode === "BEFORE" ? "active" : ""}`}
              onClick={() => props.onChangeDiffPreviewMode("BEFORE")}
            >
              看变更前
            </button>
            <button
              type="button"
              className={`studio-btn ${props.diffPreviewMode === "AFTER" ? "active" : ""}`}
              onClick={() => props.onChangeDiffPreviewMode("AFTER")}
            >
              看变更后
            </button>
          </div>

          <button type="button" className="studio-btn" style={{ width: "100%", marginTop: 6 }} onClick={props.onEnableDiffCurtain}>
            开启事件前后分屏卷帘对照
          </button>

          <div className="grid-two" style={{ marginTop: 8 }}>
            <button
              type="button"
              className="studio-btn primary"
              onClick={() => props.onReviewChangeset("COMMITTED")}
            >
              ✓ 批准入库 (COMMIT)
            </button>
            <button
              type="button"
              className="studio-btn danger"
              onClick={() => props.onReviewChangeset("ROLLED_BACK")}
            >
              ✕ 退回修订 (ROLLBACK)
            </button>
          </div>
        </div>
      )}
    </aside>
  );
}
