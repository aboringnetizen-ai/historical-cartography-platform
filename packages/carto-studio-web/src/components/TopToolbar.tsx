import type {
  LayerVisibilityConfig,
  VideoExportJobSpec,
} from "@historical-cartography/shared-schema";
import { DEMO_SCENE_BUNDLES } from "../core/data/demo-dataset.ts";
import type { EpochSceneBundle } from "../core/data/demo-types.ts";
import type { SnapshotLoadStatus } from "../core/services/snapshot-client.ts";
import type { CurtainMode } from "./MapCanvas.tsx";

export interface TopToolbarProps {
  selectedEpochId: string;
  onSelectEpoch: (epochId: string) => void;
  loadStatus: SnapshotLoadStatus;
  bundle: EpochSceneBundle;
  isDemoData: boolean;
  revisionId: string;
  baseMode: LayerVisibilityConfig["base_mode"];
  onToggleBaseMode: () => void;
  showGhostBorder: boolean;
  onToggleGhostBorder: () => void;
  curtainMode: CurtainMode;
  onCycleCurtainMode: () => void;
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
  return (
    <header className="top-toolbar">
      <div className="toolbar-group">
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
          {DEMO_SCENE_BUNDLES.map((b) => (
            <option key={b.epoch.epoch_id} value={b.epoch.epoch_id}>
              {b.epoch_label_zh}
            </option>
          ))}
        </select>

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
          {props.baseMode === "PURE_TERRITORY" ? "模式: 纯疆域" : "模式: 控制力 (0–100)"}
        </button>

        <button
          type="button"
          className={`studio-btn ${props.showGhostBorder ? "active" : ""}`}
          onClick={props.onToggleGhostBorder}
        >
          幽灵前朝界
        </button>

        <button
          type="button"
          className={`studio-btn ${props.curtainMode !== "NONE" ? "active" : ""}`}
          onClick={props.onCycleCurtainMode}
        >
          卷帘: {props.curtainMode === "NONE" ? "关" : props.curtainMode === "BEFORE_AFTER" ? "差异" : "双模"}
        </button>

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
          {props.isRecording60Hz ? "■ 停止 60Hz 录制" : "● 录制 60Hz"}
        </button>

        <button type="button" className="studio-btn active" onClick={props.onOpenDirectorModal}>
          导播与导出
        </button>

        <span className={`badge-pill ${props.g5GatePassed ? "badge-t1" : "badge-error"}`}>
          G5 {props.g5GatePassed ? "PASS" : "ALERT"}
        </span>
      </div>
    </header>
  );
}
