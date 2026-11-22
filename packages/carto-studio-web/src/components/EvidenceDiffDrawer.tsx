import { useEffect, useState } from "react";
import type {
  EventEvidenceResult,
  HistoricalToponym,
} from "@historical-cartography/shared-schema";
import type { EpochSceneBundle } from "../core/data/demo-types.ts";
import { formatTimestampWithPrecision } from "../core/director/timeline-math.ts";
import type { MapSnapshotClient } from "../core/services/snapshot-client.ts";

export interface EvidenceDiffDrawerProps {
  bundle: EpochSceneBundle;
  snapshotClient: MapSnapshotClient;
  selectedFaceId?: string | undefined;
  selectedPolityId?: string | undefined;
  selectedToponym?: HistoricalToponym | undefined;
  selectedEventId?: string | undefined;
  diffPreviewMode: "AFTER" | "BEFORE";
  onChangeDiffPreviewMode: (mode: "AFTER" | "BEFORE") => void;
  onEnableDiffCurtain: () => void;
  onSelectEvent: (eventId: string) => void;
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
  const selectedPolity = props.bundle.polities.find(
    (p) => p.polity_id === (props.selectedPolityId ?? selectedFace?.polity_id),
  );
  const activeEvent = props.bundle.events.find((e) => e.hist_event_id === activeEventId);

  return (
    <aside className="side-drawer right" aria-label="考证原文与变更差异抽屉">
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <strong style={{ fontSize: 13 }}>五维考证 · 史料原文 · 差异审阅</strong>
        <button type="button" className="studio-btn" onClick={props.onClose}>
          收起
        </button>
      </div>

      {/* Selected Territory / Human Lock Status */}
      {(selectedFace || selectedPolity) && (
        <div className="panel-section">
          <h3 className="panel-title">
            <span>{selectedPolity?.name_zh ?? selectedFace?.face_id}</span>
            {selectedFace?.human_locked_override && (
              <span className="badge-pill badge-dispute">人工锁定 G4</span>
            )}
          </h3>
          {selectedPolity && (
            <div style={{ fontSize: 11, color: "#cbd5e1", lineHeight: 1.5 }}>
              <div>原名：{selectedPolity.name_original_script ?? "—"} · 君主：{selectedPolity.monarch_name}</div>
              <div>{selectedPolity.summary}</div>
            </div>
          )}
          {selectedFace && (
            <div style={{ fontSize: 11, color: "#94a3b8", display: "flex", flexWrap: "wrap", gap: 6 }}>
              <span>面 ID: {selectedFace.face_id}</span>
              <span>控制分: {selectedFace.control_score}/100</span>
              <span>语义: {selectedFace.zone_semantics}</span>
              {selectedFace.is_sparse_or_desert_zone && <span>荒漠低控闭合面（未挖空）</span>}
            </div>
          )}
        </div>
      )}

      {/* Selected Toponym Traceability ("点地溯源") */}
      {props.selectedToponym && (
        <div className="panel-section">
          <h3 className="panel-title">
            <span>点地溯源 · {props.selectedToponym.name_zh}</span>
            <span className="badge-pill badge-t2">{props.selectedToponym.location_precision}</span>
          </h3>
          <div style={{ fontSize: 11, color: "#cbd5e1", lineHeight: 1.5 }}>
            <div>原语拼写：{props.selectedToponym.name_original_script ?? "—"}</div>
            <div>异名/音译：{props.selectedToponym.alt_names_and_transliterations.join("、") || "—"}</div>
            <div>今地对照：{props.selectedToponym.modern_name ?? "待考"} ({props.selectedToponym.coordinates[0]}, {props.selectedToponym.coordinates[1]})</div>
          </div>
          {props.bundle.admin_evolutions.length > 0 && (
            <div style={{ fontSize: 11, color: "#94a3b8", borderTop: "1px solid rgba(148,163,184,0.16)", paddingTop: 6 }}>
              政区沿革：{props.bundle.admin_evolutions.map((ev) => `${ev.change_type} (${ev.timestamp.historical_year_display})`).join("；")}
            </div>
          )}
        </div>
      )}

      {/* Historical Event & OCR Citation Verification Drawer */}
      <div className="panel-section">
        <h3 className="panel-title">
          <span>史料引文核验 (EventEvidenceReader)</span>
          <div style={{ display: "flex", gap: 4 }}>
            <button
              type="button"
              className="studio-btn"
              style={{ fontSize: 10, padding: "2px 6px" }}
              onClick={() => setOverrideEventId("fixture-event")}
              title="测试 Phase 0 待核验契约样例"
            >
              测试 T3 待核验
            </button>
            <button
              type="button"
              className="studio-btn"
              style={{ fontSize: 10, padding: "2px 6px" }}
              onClick={() => setOverrideEventId("fixture-event-rejected")}
              title="测试 Phase 0 假引文拦截契约样例"
            >
              测试假引文拦截
            </button>
          </div>
        </h3>

        {props.bundle.events.length > 0 && (
          <select
            aria-label="选择历史事件"
            className="studio-select"
            value={activeEventId ?? ""}
            onChange={(e) => {
              setOverrideEventId(null);
              props.onSelectEvent(e.target.value);
            }}
          >
            {props.bundle.events.map((ev) => (
              <option key={ev.hist_event_id} value={ev.hist_event_id}>
                [{ev.conflict_status}] {ev.title}
              </option>
            ))}
          </select>
        )}

        {activeEvent && (
          <div style={{ fontSize: 11, color: "#cbd5e1", lineHeight: 1.5 }}>
            <div><strong>时刻与精度：</strong>{formatTimestampWithPrecision(activeEvent.time_start)}</div>
            <div><strong>空间影响：</strong>{activeEvent.spatial_impact_description}</div>
          </div>
        )}

        {evidenceResult?.status === "VERIFIED" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <span className="badge-pill badge-t1">
              VERIFIED · 修订 {evidenceResult.event_revision}
            </span>
            {evidenceResult.verified_citations.map((vc) => {
              const doc = props.bundle.sources.find((s) => s.source_doc_id === vc.source_doc_id);
              return (
                <div key={vc.citation_id} className="quote-box">
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, marginBottom: 4 }}>
                    <strong>{doc?.title ?? vc.source_doc_id}</strong>
                    <span className="badge-pill badge-t1">{vc.evidence.credibility_tier.split("_")[0]}</span>
                  </div>
                  <div style={{ fontSize: 10, color: "#94a3b8", marginBottom: 4 }}>
                    卷章：{vc.evidence.volume_or_chapter ?? "—"} · 页码：{vc.evidence.page_number ?? "—"} ·
                    OCR 行号：{vc.evidence.ocr_line_range ? `${vc.evidence.ocr_line_range[0]}–${vc.evidence.ocr_line_range[1]}` : "—"} ·
                    匹配度：{Math.round((vc.evidence.quote_match_score ?? 1) * 100)}% · 索引版本：{vc.index_revision}
                  </div>
                  <div style={{ color: "#f8fafc", fontStyle: "italic" }}>
                    “{vc.evidence.verbatim_quote}”
                  </div>
                  {vc.evidence.translation_or_note && (
                    <div style={{ fontSize: 11, color: "#cbd5e1", marginTop: 4 }}>
                      考注：{vc.evidence.translation_or_note}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {evidenceResult && evidenceResult.status !== "VERIFIED" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span className={`badge-pill ${evidenceResult.status === "REJECTED" ? "badge-error" : "badge-dispute"}`}>
              {evidenceResult.status} · 硬门禁拦截
            </span>
            {evidenceResult.issues.map((issue, idx) => (
              <div
                key={`${issue.code}-${idx}`}
                className="quote-box"
                style={{ borderLeftColor: evidenceResult.status === "REJECTED" ? "#ef4444" : "#f59e0b" }}
              >
                <div style={{ fontWeight: 700, fontSize: 11 }}>
                  [{issue.gate}] {issue.code} ({issue.entity_id ?? "—"})
                </div>
                <div style={{ fontSize: 11, color: "#e2e8f0" }}>{issue.message}</div>
              </div>
            ))}
            {activeEvent && activeEvent.citations.length > 0 && (
              <div style={{ fontSize: 11, color: "#cbd5e1", display: "flex", flexDirection: "column", gap: 4 }}>
                {activeEvent.citations.map((c) => (
                  <div key={c.citation_id} className="quote-box" style={{ borderLeftColor: "#38bdf8" }}>
                    <div style={{ fontSize: 10, color: "#94a3b8" }}>
                      {c.source_doc_id} · {c.page_number ?? c.web_section_anchor ?? "待补页码"}
                    </div>
                    <div>“{c.verbatim_quote}”</div>
                    {c.translation_or_note && <div style={{ color: "#94a3b8" }}>{c.translation_or_note}</div>}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Before / After Spatial ChangeSet Diff Preview */}
      {props.bundle.diff_record && (
        <div className="panel-section">
          <h3 className="panel-title">
            <span>变更差异预览 (Before / After)</span>
            <span className="badge-pill badge-dispute">{props.bundle.diff_record.changeset.status}</span>
          </h3>
          <div style={{ fontSize: 11, color: "#cbd5e1", lineHeight: 1.5 }}>
            <div>事务 ID：{props.bundle.diff_record.changeset.changeset_id}</div>
            <div>分支：{props.bundle.diff_record.changeset.branch_name}</div>
            <div>{props.bundle.diff_record.summary_zh}</div>
          </div>

          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            <button
              type="button"
              className={`studio-btn ${props.diffPreviewMode === "BEFORE" ? "active" : ""}`}
              onClick={() => props.onChangeDiffPreviewMode("BEFORE")}
            >
              查看 Before ({props.bundle.diff_record.before_snapshot.revision_id.slice(-10)})
            </button>
            <button
              type="button"
              className={`studio-btn ${props.diffPreviewMode === "AFTER" ? "active" : ""}`}
              onClick={() => props.onChangeDiffPreviewMode("AFTER")}
            >
              查看 After ({props.bundle.diff_record.after_snapshot.revision_id.slice(-10)})
            </button>
            <button type="button" className="studio-btn" onClick={props.onEnableDiffCurtain}>
              开启双版卷帘对比
            </button>
          </div>

          <div style={{ fontSize: 10, color: "#94a3b8", display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 4 }}>
            <span>G1 拓扑: {props.bundle.diff_record.changeset.gate_report.g1_topology_passed ? "PASS" : "FAIL"}</span>
            <span>G1.5 平滑: {props.bundle.diff_record.changeset.gate_report.g1_5_smoothness_passed ? "PASS" : "FAIL"}</span>
            <span>G2 事件: {props.bundle.diff_record.changeset.gate_report.g2_event_binding_passed ? "PASS" : "FAIL"}</span>
            <span>G3 原文: {props.bundle.diff_record.changeset.gate_report.g3_provenance_quote_passed ? "PASS" : "FAIL"}</span>
            <span>G4 人工锁: {props.bundle.diff_record.changeset.gate_report.g4_human_lock_passed ? "PASS" : "待审(锁定)"}</span>
          </div>
        </div>
      )}
    </aside>
  );
}
