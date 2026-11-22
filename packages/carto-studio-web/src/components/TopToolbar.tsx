import { useMemo, useState } from "react";
import type {
  LayerVisibilityConfig,
  VideoExportJobSpec,
} from "@historical-cartography/shared-schema";
import type { EpochSceneBundle } from "../core/data/demo-types.ts";
import type { SnapshotLoadStatus } from "../core/services/snapshot-client.ts";
import type { CurtainMode } from "./MapCanvas.tsx";

export interface GlobalSearchHit {
  id: string;
  epoch_id: string;
  epoch_label_zh: string;
  kind: "POLITY" | "TOPONYM" | "FIGURE" | "EVENT";
  label_zh: string;
  sublabel: string;
  coordinates?: [number, number];
  polity_id?: string;
  toponym_id?: string;
  event_id?: string;
  jdn?: number;
}

export interface TopToolbarProps {
  selectedEpochId: string;
  allBundles: readonly EpochSceneBundle[];
  onSelectEpoch: (epochId: string) => void;
  onSelectSearchHit: (hit: GlobalSearchHit) => void;
  loadStatus: SnapshotLoadStatus;
  bundle: EpochSceneBundle;
  isDemoData: boolean;
  revisionId: string;
  baseMode: LayerVisibilityConfig["base_mode"];
  onToggleBaseMode: () => void;
  showGhostBorder: boolean;
  onToggleGhostBorder: () => void;
  curtainMode: CurtainMode;
  onChangeCurtainMode: (mode: CurtainMode) => void;
  aspectRatio: VideoExportJobSpec["aspect_ratio"];
  onChangeAspectRatio: (ratio: VideoExportJobSpec["aspect_ratio"]) => void;
  showStylePanel: boolean;
  onToggleStylePanel: () => void;
  showEvidencePanel: boolean;
  onToggleEvidencePanel: () => void;
  isRecording60Hz: boolean;
  onToggleRecording: () => void;
  onOpenDirectorModal: () => void;
  onRetrySnapshot: () => void;
  g5GatePassed: boolean;
}

export function TopToolbar(props: TopToolbarProps) {
  const [query, setQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);

  const searchHits = useMemo<GlobalSearchHit[]>(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const out: GlobalSearchHit[] = [];
    for (const b of props.allBundles) {
      for (const p of b.polities) {
        if (
          p.name_zh.toLowerCase().includes(q)
          || (p.name_original_script ?? "").toLowerCase().includes(q)
          || p.monarch_name.toLowerCase().includes(q)
        ) {
          const cap = b.toponyms.find((t) => t.toponym_id === p.capital_toponym_id);
          out.push({
            id: `pol-${b.epoch.epoch_id}-${p.polity_id}`,
            epoch_id: b.epoch.epoch_id,
            epoch_label_zh: b.epoch_label_zh,
            kind: "POLITY",
            label_zh: p.name_zh,
            sublabel: `政权 · ${p.monarch_name} · ${b.epoch_label_zh}`,
            polity_id: p.polity_id,
            coordinates: cap?.coordinates ?? b.default_camera.center,
            jdn: b.epoch.valid_from_jdn,
          });
        }
      }
      for (const t of b.toponyms) {
        if (
          t.name_zh.toLowerCase().includes(q)
          || (t.modern_name ?? "").toLowerCase().includes(q)
          || (t.name_original_script ?? "").toLowerCase().includes(q)
          || t.alt_names_and_transliterations.some((a) => a.toLowerCase().includes(q))
        ) {
          out.push({
            id: `top-${b.epoch.epoch_id}-${t.toponym_id}`,
            epoch_id: b.epoch.epoch_id,
            epoch_label_zh: b.epoch_label_zh,
            kind: "TOPONYM",
            label_zh: t.name_zh,
            sublabel: `地名 · 今${t.modern_name ?? "考证中"} · ${b.epoch_label_zh}`,
            toponym_id: t.toponym_id,
            coordinates: t.coordinates,
            jdn: Math.max(b.epoch.valid_from_jdn, t.valid_from_jdn),
          });
        }
      }
      for (const f of b.figures) {
        if (f.name_zh.toLowerCase().includes(q) || f.title.toLowerCase().includes(q)) {
          out.push({
            id: `fig-${b.epoch.epoch_id}-${f.figure_id}`,
            epoch_id: b.epoch.epoch_id,
            epoch_label_zh: b.epoch_label_zh,
            kind: "FIGURE",
            label_zh: f.name_zh,
            sublabel: `人物 · ${f.title} · ${b.epoch_label_zh}`,
            polity_id: f.polity_id,
            coordinates: f.coordinates ?? b.default_camera.center,
            jdn: f.active_from_jdn,
          });
        }
      }
      for (const ev of b.events) {
        if (ev.title.toLowerCase().includes(q) || ev.summary.toLowerCase().includes(q)) {
          out.push({
            id: `ev-${b.epoch.epoch_id}-${ev.hist_event_id}`,
            epoch_id: b.epoch.epoch_id,
            epoch_label_zh: b.epoch_label_zh,
            kind: "EVENT",
            label_zh: ev.title,
            sublabel: `事件 · ${ev.time_start.historical_year_display}`,
            event_id: ev.hist_event_id,
            jdn: ev.time_start.julian_day_number,
          });
        }
      }
    }
    return out.slice(0, 12);
  }, [query, props.allBundles]);

  return (
    <header className="top-toolbar">
      <div className="toolbar-group" style={{ position: "relative" }}>
        <div className="brand-mark">
          <span className="brand-dot" />
          <span>Carto Studio v4.0</span>
        </div>

        <select
          aria-label="历史时期切片"
          className="studio-select"
          value={props.selectedEpochId}
          onChange={(e) => props.onSelectEpoch(e.target.value)}
        >
          {props.allBundles.map((b) => (
            <option key={b.epoch.epoch_id} value={b.epoch.epoch_id}>
              {b.epoch_label_zh}
            </option>
          ))}
        </select>

        <div style={{ position: "relative" }}>
          <input
            type="search"
            aria-label="跨时代地名/政权/人物/事件搜索"
            placeholder="搜索地名/政权/人物/事件..."
            value={query}
            onFocus={() => setSearchOpen(true)}
            onBlur={() => setTimeout(() => setSearchOpen(false), 160)}
            onChange={(e) => {
              setQuery(e.target.value);
              setSearchOpen(true);
            }}
            style={{
              width: 152,
              padding: "4px 8px",
              borderRadius: 6,
              border: "1px solid var(--border-strong)",
              background: "#0f172a",
              color: "#f8fafc",
              fontSize: 11,
            }}
          />
          {searchOpen && searchHits.length > 0 && (
            <div
              style={{
                position: "absolute",
                top: "calc(100% + 4px)",
                left: 0,
                width: 310,
                maxHeight: 280,
                overflowY: "auto",
                background: "#0f172a",
                border: "1px solid rgba(56, 189, 248, 0.55)",
                borderRadius: 8,
                boxShadow: "0 14px 30px rgba(0,0,0,0.65)",
                zIndex: 60,
              }}
            >
              {searchHits.map((hit) => (
                <button
                  key={hit.id}
                  type="button"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    props.onSelectSearchHit(hit);
                    setSearchOpen(false);
                    setQuery("");
                  }}
                  style={{
                    display: "block",
                    width: "100%",
                    textAlign: "left",
                    padding: "7px 10px",
                    background: "transparent",
                    border: "none",
                    borderBottom: "1px solid rgba(148, 163, 184, 0.14)",
                    color: "#f8fafc",
                    cursor: "pointer",
                  }}
                >
                  <div style={{ fontWeight: 700, fontSize: 12 }}>{hit.label_zh}</div>
                  <div style={{ fontSize: 10, color: "#94a3b8" }}>{hit.sublabel}</div>
                </button>
              ))}
            </div>
          )}
        </div>

        <span className={`badge-pill ${props.bundle.data_status === "COMMITTED" ? "badge-committed" : "badge-draft"}`}>
          {props.bundle.data_status}
        </span>

        {props.isDemoData && (
          <span className="badge-pill badge-t2" title="当前使用契约兼容演示夹具">
            演示数据
          </span>
        )}

        <span
          className={`badge-pill ${
            props.loadStatus === "ERROR"
              ? "badge-error"
              : props.loadStatus === "LOADING"
                ? "badge-dispute"
                : "badge-t1"
          }`}
          title={`快照修订版本: ${props.revisionId}`}
        >
          {props.loadStatus} · {props.revisionId.slice(0, 12)}
        </span>

        {props.loadStatus === "ERROR" && (
          <button type="button" className="studio-btn warn" onClick={props.onRetrySnapshot}>
            重试加载
          </button>
        )}
      </div>

      <div className="toolbar-group">
        <button
          type="button"
          className={`studio-btn ${props.baseMode === "CONTROL_INTENSITY" ? "active" : ""}`}
          onClick={props.onToggleBaseMode}
          title="同一套拓扑数据源无缝切换纯疆域与 0–100 控制力梯度"
        >
          {props.baseMode === "PURE_TERRITORY" ? "纯疆域" : "控制力"}
        </button>

        <button
          type="button"
          className={`studio-btn ${props.showGhostBorder ? "active" : ""}`}
          onClick={props.onToggleGhostBorder}
        >
          前朝界
        </button>

        <select
          aria-label="地图卷帘对比模式"
          className="studio-select"
          value={props.curtainMode}
          onChange={(e) => props.onChangeCurtainMode(e.target.value as CurtainMode)}
        >
          <option value="NONE">卷帘: 关闭</option>
          <option value="ANCIENT_VS_MODERN">卷帘: 古今对照</option>
          <option value="PURE_VS_CONTROL">卷帘: 双模控制力</option>
          <option value="BEFORE_AFTER">卷帘: 事件前后</option>
        </select>

        <select
          aria-label="导播画幅安全区"
          className="studio-select"
          value={props.aspectRatio}
          onChange={(e) => props.onChangeAspectRatio(e.target.value as VideoExportJobSpec["aspect_ratio"])}
        >
          <option value="16:9">画幅 16:9</option>
          <option value="9:16">竖屏 9:16</option>
          <option value="1:1">方屏 1:1</option>
          <option value="21:9">宽银幕 21:9</option>
        </select>

        <button
          type="button"
          className={`studio-btn ${props.showStylePanel ? "active" : ""}`}
          onClick={props.onToggleStylePanel}
        >
          风格与图层
        </button>

        <button
          type="button"
          className={`studio-btn ${props.showEvidencePanel ? "active" : ""}`}
          onClick={props.onToggleEvidencePanel}
        >
          考证与差异
        </button>

        <button
          type="button"
          className={`studio-btn ${props.isRecording60Hz ? "danger" : ""}`}
          onClick={props.onToggleRecording}
        >
          {props.isRecording60Hz ? "● 停止" : "● 60Hz"}
        </button>

        <button type="button" className="studio-btn primary" onClick={props.onOpenDirectorModal}>
          导播导出 {props.g5GatePassed ? "✓" : "!"}
        </button>
      </div>
    </header>
  );
}
