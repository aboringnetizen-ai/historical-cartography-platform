import { useEffect, useState } from "react";
import type {
  ComposableStylePack,
  DirectorKeyframe,
  MapSnapshot,
  VideoExportJobSpec,
} from "@historical-cartography/shared-schema";
import type { EpochSceneBundle } from "../core/data/demo-types.ts";
import { classifyTopologyTransition } from "../core/director/morph-engine.ts";
import type { AspectSafeAreaLayout, HudWidgetSpec } from "../core/director/recorder-and-hud.ts";
import type {
  DeterministicFaultFlags,
  DeterministicFrameBridge,
  StepFrameResult,
} from "../core/render/deterministic-bridge.ts";
import {
  downloadTextOrDataUrl,
  generateSrtSubtitles,
  generateStandaloneSvgExport,
  generateT1BibliographyMarkdown,
  generateVideoChaptersTxt,
} from "./export-generators.ts";

export interface DirectorExportModalProps {
  bundle: EpochSceneBundle;
  displaySnapshot: MapSnapshot;
  stylePack: ComposableStylePack;
  polityColors: Record<string, string>;
  keyframes: DirectorKeyframe[];
  hudWidgets: HudWidgetSpec[];
  hudLayout: AspectSafeAreaLayout;
  enabledHudTypes: ReadonlySet<string>;
  aspectRatio: VideoExportJobSpec["aspect_ratio"];
  autoReflowVertical: boolean;
  showSafeGuides: boolean;
  telemetryCount: number;
  audioNarrationUri: string;
  bridge: DeterministicFrameBridge;
  captureMapPng?: (() => string | null) | undefined;
  onToggleHudType: (type: string) => void;
  onChangeAspectRatio: (ratio: VideoExportJobSpec["aspect_ratio"]) => void;
  onToggleAutoReflowVertical: () => void;
  onToggleSafeGuides: () => void;
  onChangeAudioNarrationUri: (uri: string) => void;
  onGenerateStoryboardFromEvents: (scriptLines: string[]) => void;
  onUpdateKeyframe: (keyframeId: string, patch: Partial<DirectorKeyframe>) => void;
  onUpdateHudWidget: (widgetId: string, patch: Partial<HudWidgetSpec>) => void;
  onPreviewKeyframe: (kf: DirectorKeyframe) => void;
  onClose: () => void;
}

const ALL_HUD_TYPES: Array<{ type: HudWidgetSpec["type"]; label: string }> = [
  { type: "DATE_ERA_BADGE", label: "DATE_ERA_BADGE (年代/年号角标)" },
  { type: "FIGURE_PORTRAIT_PIN", label: "FIGURE_PORTRAIT_PIN (地图立绘钉)" },
  { type: "COALITION_ROSTER_SIDEBAR", label: "COALITION_ROSTER_SIDEBAR (参战名录)" },
  { type: "POLITY_DASHBOARD_PANEL", label: "POLITY_DASHBOARD_PANEL (政权仪表盘)" },
  { type: "CHRONICLE_TEXT_OVERLAY", label: "CHRONICLE_TEXT_OVERLAY (编年专栏)" },
  { type: "SUBTITLE_BAR", label: "SUBTITLE_BAR (解说字幕条)" },
  { type: "PIP_INSET_MAP", label: "PIP_INSET_MAP (画中画小地图)" },
];

export function DirectorExportModal(props: DirectorExportModalProps) {
  const [resolution, setResolution] = useState<VideoExportJobSpec["resolution"]>("1080p");
  const [fps, setFps] = useState<VideoExportJobSpec["fps"]>(60);
  const [outputFormat, setOutputFormat] = useState<VideoExportJobSpec["output_format"]>("MP4_H264");
  const [autoSrt, setAutoSrt] = useState(true);
  const [autoBib, setAutoBib] = useState(true);
  const [scriptText, setScriptText] = useState("");
  const [faults, setFaults] = useState<DeterministicFaultFlags>({});
  const [stepResult, setStepResult] = useState<StepFrameResult | null>(null);
  const [remoteJobId, setRemoteJobId] = useState<string | null>(null);
  const [exportStatus, setExportStatus] = useState<{
    state: "IDLE" | "BLOCKED" | "SUBMITTED";
    message: string;
    spec?: VideoExportJobSpec;
  }>({ state: "IDLE", message: "" });

  useEffect(() => {
    const defaultLines =
      props.bundle.events.length > 0
        ? props.bundle.events.map((e) => e.summary).join("\n")
        : props.bundle.subtitle_default ?? `${props.bundle.historical_year_display} ${props.bundle.epoch_label_zh}`;
    setScriptText(defaultLines);
  }, [props.bundle.epoch.epoch_id, props.bundle.events, props.bundle.subtitle_default, props.bundle.historical_year_display, props.bundle.epoch_label_zh]);

  const transitionCheck = props.bundle.diff_record
    ? classifyTopologyTransition(props.bundle.diff_record.before_snapshot, props.bundle.diff_record.after_snapshot)
    : null;

  const apiBase = (import.meta as unknown as { env?: Record<string, string | undefined> }).env?.VITE_CARTO_API_BASE;

  const runDeterministicSmoke = async (overrideFaults?: DeterministicFaultFlags) => {
    const activeFaults = overrideFaults ?? faults;
    props.bridge.setFaultFlags(activeFaults);
    const result = await props.bridge.stepFrame(1000);
    setStepResult(result);
    return result;
  };

  const handleSubmitExport = async () => {
    const gateCheck = await runDeterministicSmoke(faults);
    if (!gateCheck.accepted) {
      setExportStatus({
        state: "BLOCKED",
        message: `G5 硬门禁拦截导出：${gateCheck.g5_gate.issues.map((i) => `[${i.code}] ${i.message}`).join(" | ")}`,
      });
      return;
    }

    const activeWidgets = props.hudWidgets.filter((w) => props.enabledHudTypes.has(w.type));
    const spec: VideoExportJobSpec = {
      project_id: `proj-${props.bundle.epoch.epoch_id}`,
      aspect_ratio: props.aspectRatio,
      resolution,
      fps,
      output_format: outputFormat,
      keyframes: props.keyframes,
      hud_widgets: activeWidgets,
      ...(props.audioNarrationUri.trim() ? { audio_narration_uri: props.audioNarrationUri.trim() } : {}),
      auto_generate_srt: autoSrt,
      auto_generate_bibliography_credits: autoBib,
    };

    if (apiBase) {
      try {
        const resp = await fetch(`${apiBase.replace(/\/$/, "")}/video-export-jobs`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(spec),
        });
        if (resp.ok) {
          const data = (await resp.json()) as { job_id?: string };
          setRemoteJobId(data.job_id ?? `job-${Date.now()}`);
        }
      } catch {
        // Fallback smoothly to local client export spec when backend renderer is offline
      }
    }

    setExportStatus({
      state: "SUBMITTED",
      message: `已通过 G5 帧同步与安全区校验，生成 ${spec.aspect_ratio} ${spec.resolution} @ ${spec.fps}fps (${spec.output_format}) 导出规格${remoteJobId ? ` · 远端任务 ${remoteJobId}` : ""}。`,
      spec,
    });
  };

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="视频导播室与确定性导出面板">
      <div className="modal-card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <strong style={{ fontSize: 15 }}>内置历史地图视频导播室 · 确定性渲染与多格式导出 (G5)</strong>
          <button type="button" className="studio-btn" onClick={props.onClose}>
            关闭
          </button>
        </div>

        {/* Script Storyboard & Narration Track */}
        <div className="panel-section">
          <h3 className="panel-title">
            <span>AI 文案自动导播 & 60Hz 遥测 ({props.telemetryCount} 帧样本 → {props.keyframes.length} 关键帧)</span>
          </h3>
          <textarea className="studio-input" rows={2} value={scriptText} onChange={(e) => setScriptText(e.target.value)} />
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <input
              type="text"
              className="studio-input"
              style={{ flex: 1, minWidth: 220 }}
              placeholder="配音音轨 URI（例：/audio/960-975-central-asia-narration.wav）"
              value={props.audioNarrationUri}
              onChange={(e) => props.onChangeAudioNarrationUri(e.target.value)}
            />
            <button
              type="button"
              className="studio-btn active"
              onClick={() => props.onGenerateStoryboardFromEvents(scriptText.split(/\n+/).filter(Boolean))}
            >
              依据时间轴事件生成分镜
            </button>
            {transitionCheck && <span className="badge-pill badge-t2">{transitionCheck.reason_zh}</span>}
          </div>
        </div>

        {/* Keyframes & HUD Windows Editor */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <div className="panel-section" style={{ maxHeight: 220, overflowY: "auto" }}>
            <h3 className="panel-title">关键帧编辑与拓扑非同胚回退</h3>
            {props.keyframes.map((kf, idx) => (
              <div
                key={kf.keyframe_id}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  gap: 4,
                  fontSize: 11,
                  padding: "4px 6px",
                  borderRadius: 4,
                  background: "rgba(15,23,42,0.7)",
                }}
              >
                <button
                  type="button"
                  className="studio-btn"
                  style={{ padding: "1px 6px", fontSize: 10 }}
                  onClick={() => props.onPreviewKeyframe(kf)}
                >
                  预览 KF{idx + 1}
                </button>
                <input
                  type="number"
                  step={0.5}
                  min={0}
                  className="studio-input"
                  style={{ width: 52, padding: "1px 4px", fontSize: 10 }}
                  value={kf.video_time_sec}
                  onChange={(e) => props.onUpdateKeyframe(kf.keyframe_id, { video_time_sec: Math.max(0, Number(e.target.value)) })}
                />
                <select
                  className="studio-select"
                  style={{ padding: "1px 4px", fontSize: 10, width: 92 }}
                  value={kf.easing}
                  onChange={(e) => props.onUpdateKeyframe(kf.keyframe_id, { easing: e.target.value as DirectorKeyframe["easing"] })}
                >
                  <option value="LINEAR">LINEAR</option>
                  <option value="EASE_IN_OUT_CUBIC">CUBIC</option>
                  <option value="CAMERA_FLY_TO">FLY_TO</option>
                </select>
                <select
                  className="studio-select"
                  style={{ padding: "1px 4px", fontSize: 10, width: 105 }}
                  value={kf.topology_change_fallback ?? "OCCUPATION_RIPPLE"}
                  onChange={(e) =>
                    props.onUpdateKeyframe(kf.keyframe_id, {
                      topology_change_fallback: e.target.value as NonNullable<DirectorKeyframe["topology_change_fallback"]>,
                    })
                  }
                >
                  <option value="OCCUPATION_RIPPLE">波纹蚕食</option>
                  <option value="WIPE_MASK">推进遮罩</option>
                  <option value="CROSS_DISSOLVE">交叉淡入淡出</option>
                </select>
              </div>
            ))}
          </div>

          <div className="panel-section" style={{ maxHeight: 220, overflowY: "auto" }}>
            <h3 className="panel-title">
              <span>HUD 挂件安全区与时窗</span>
              <span className={`badge-pill ${props.hudLayout.g5_hud_gate.passed ? "badge-t1" : "badge-error"}`}>
                {props.hudLayout.g5_hud_gate.passed ? "安全区通过" : `${props.hudLayout.g5_hud_gate.issues.length} 冲突`}
              </span>
            </h3>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", fontSize: 11 }}>
              {(["16:9", "9:16", "1:1", "21:9"] as const).map((r) => (
                <button
                  key={r}
                  type="button"
                  className={`studio-btn ${props.aspectRatio === r ? "active" : ""}`}
                  style={{ padding: "2px 7px", fontSize: 10 }}
                  onClick={() => props.onChangeAspectRatio(r)}
                >
                  {r}
                </button>
              ))}
              <label className="chip-row" style={{ fontSize: 10 }}>
                <input type="checkbox" checked={props.autoReflowVertical} onChange={props.onToggleAutoReflowVertical} />
                9:16避让
              </label>
              <label className="chip-row" style={{ fontSize: 10 }}>
                <input type="checkbox" checked={props.showSafeGuides} onChange={props.onToggleSafeGuides} />
                安全框
              </label>
            </div>
            {ALL_HUD_TYPES.map((item) => (
              <label key={item.type} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11 }}>
                <input type="checkbox" checked={props.enabledHudTypes.has(item.type)} onChange={() => props.onToggleHudType(item.type)} />
                <span>{item.label}</span>
              </label>
            ))}
            {props.hudWidgets.filter((w) => w.type === "SUBTITLE_BAR").map((sub) => (
              <div key={sub.widget_id} style={{ display: "flex", gap: 4, alignItems: "center", fontSize: 10 }}>
                <input
                  type="number"
                  step={0.5}
                  className="studio-input"
                  style={{ width: 44, padding: "1px 3px", fontSize: 10 }}
                  value={sub.visible_from_sec}
                  onChange={(e) => props.onUpdateHudWidget(sub.widget_id, { visible_from_sec: Number(e.target.value) })}
                />
                <span>-</span>
                <input
                  type="number"
                  step={0.5}
                  className="studio-input"
                  style={{ width: 44, padding: "1px 3px", fontSize: 10 }}
                  value={sub.visible_to_sec}
                  onChange={(e) => props.onUpdateHudWidget(sub.widget_id, { visible_to_sec: Number(e.target.value) })}
                />
                <input
                  type="text"
                  className="studio-input"
                  style={{ flex: 1, padding: "1px 4px", fontSize: 10 }}
                  value={(sub.data_binding.text as string | undefined) ?? ""}
                  onChange={(e) =>
                    props.onUpdateHudWidget(sub.widget_id, { data_binding: { ...sub.data_binding, text: e.target.value } })
                  }
                />
              </div>
            ))}
          </div>
        </div>

        {/* Deterministic G5 Barrier + Multi-Format Real Exports */}
        <div className="panel-section">
          <h3 className="panel-title">
            <span>G5 帧栅栏故障演练 & 真实交付下载</span>
            <button type="button" className="studio-btn" style={{ padding: "2px 8px", fontSize: 11 }} onClick={() => void runDeterministicSmoke(faults)}>
              执行 `__STEP_FRAME__(1000ms)` 检核
            </button>
          </h3>

          <div style={{ display: "flex", gap: 14, flexWrap: "wrap", fontSize: 11 }}>
            <label className="chip-row">
              <input
                type="checkbox"
                checked={Boolean(faults.force_fonts_not_loaded)}
                onChange={(e) => {
                  const next = { ...faults, force_fonts_not_loaded: e.target.checked };
                  setFaults(next);
                  props.bridge.setFaultFlags(next);
                }}
              />
              注入字体未加载故障
            </label>
            <label className="chip-row">
              <input
                type="checkbox"
                checked={Boolean(faults.force_tiles_incomplete)}
                onChange={(e) => {
                  const next = { ...faults, force_tiles_incomplete: e.target.checked };
                  setFaults(next);
                  props.bridge.setFaultFlags(next);
                }}
              />
              注入瓦片未完整到达故障
            </label>
            {stepResult && (
              <span className={`badge-pill ${stepResult.accepted ? "badge-t1" : "badge-error"}`}>
                {stepResult.accepted ? "READY · 栅栏全绿" : `BLOCKED: ${stepResult.g5_gate.issues.map((i) => i.code).join(",")}`}
              </span>
            )}
          </div>

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 4 }}>
            <select className="studio-select" style={{ width: 90 }} value={resolution} onChange={(e) => setResolution(e.target.value as VideoExportJobSpec["resolution"])}>
              <option value="1080p">1080p</option>
              <option value="1440p">1440p</option>
              <option value="4K">4K</option>
            </select>
            <select className="studio-select" style={{ width: 82 }} value={fps} onChange={(e) => setFps(Number(e.target.value) as VideoExportJobSpec["fps"])}>
              <option value={30}>30fps</option>
              <option value={60}>60fps</option>
            </select>
            <select className="studio-select" style={{ width: 155 }} value={outputFormat} onChange={(e) => setOutputFormat(e.target.value as VideoExportJobSpec["output_format"])}>
              <option value="MP4_H264">MP4 (H.264)</option>
              <option value="MP4_HEVC">MP4 (HEVC)</option>
              <option value="WEBM_ALPHA">WebM 透明通道</option>
              <option value="PRORES_4444">ProRes 4444</option>
              <option value="INTERACTIVE_WEB_BUNDLE">交互网页包</option>
            </select>
            <label className="chip-row" style={{ fontSize: 11 }}>
              <input type="checkbox" checked={autoSrt} onChange={(e) => setAutoSrt(e.target.checked)} />
              SRT
            </label>
            <label className="chip-row" style={{ fontSize: 11 }}>
              <input type="checkbox" checked={autoBib} onChange={(e) => setAutoBib(e.target.checked)} />
              T1致谢
            </label>
            <button type="button" className="studio-btn primary" style={{ marginLeft: "auto" }} onClick={() => void handleSubmitExport()}>
              校验证书并生成导出规格
            </button>
          </div>

          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 4 }}>
            <button
              type="button"
              className="studio-btn"
              onClick={() => {
                const png = props.captureMapPng?.();
                if (png) downloadTextOrDataUrl(`${props.bundle.epoch.epoch_id}.png`, png);
              }}
            >
              下载高清 PNG 快照
            </button>
            <button
              type="button"
              className="studio-btn"
              onClick={() =>
                downloadTextOrDataUrl(
                  `${props.bundle.epoch.epoch_id}.svg`,
                  generateStandaloneSvgExport(props.bundle, props.displaySnapshot, props.stylePack, props.polityColors),
                  "image/svg+xml",
                )
              }
            >
              下载矢量 SVG 地图
            </button>
            <button
              type="button"
              className="studio-btn"
              onClick={() =>
                downloadTextOrDataUrl(`${props.bundle.epoch.epoch_id}.srt`, generateSrtSubtitles(props.hudWidgets, props.bundle), "text/plain")
              }
            >
              下载 .srt 字幕
            </button>
            <button
              type="button"
              className="studio-btn"
              onClick={() =>
                downloadTextOrDataUrl(`${props.bundle.epoch.epoch_id}-chapters.txt`, generateVideoChaptersTxt(props.keyframes, props.bundle), "text/plain")
              }
            >
              下载章节时间轴
            </button>
            <button
              type="button"
              className="studio-btn"
              onClick={() =>
                downloadTextOrDataUrl(`${props.bundle.epoch.epoch_id}-t1-credits.md`, generateT1BibliographyMarkdown(props.bundle), "text/markdown")
              }
            >
              下载 T1 文献致谢
            </button>
          </div>

          {exportStatus.state !== "IDLE" && (
            <div className="quote-box" style={{ borderLeftColor: exportStatus.state === "BLOCKED" ? "#ef4444" : "#34d399" }}>
              <div>{exportStatus.message}</div>
              {exportStatus.spec && (
                <button
                  type="button"
                  className="studio-btn"
                  style={{ marginTop: 6, fontSize: 10 }}
                  onClick={() =>
                    downloadTextOrDataUrl(`${exportStatus.spec!.project_id}-job-spec.json`, JSON.stringify(exportStatus.spec, null, 2), "application/json")
                  }
                >
                  下载完整 VideoExportJobSpec.json
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
