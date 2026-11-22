import { useState } from "react";
import type {
  DirectorKeyframe,
  VideoExportJobSpec,
} from "@historical-cartography/shared-schema";
import type { EpochSceneBundle } from "../core/data/demo-types.ts";
import {
  classifyTopologyTransition,
  type AspectSafeAreaLayout,
  type HudWidgetSpec,
} from "../core/director/recorder-and-hud.ts";
import type {
  DeterministicFaultFlags,
  DeterministicFrameBridge,
  StepFrameResult,
} from "../core/render/deterministic-bridge.ts";

export interface DirectorExportModalProps {
  bundle: EpochSceneBundle;
  keyframes: DirectorKeyframe[];
  hudWidgets: HudWidgetSpec[];
  hudLayout: AspectSafeAreaLayout;
  enabledHudTypes: ReadonlySet<string>;
  aspectRatio: VideoExportJobSpec["aspect_ratio"];
  autoReflowVertical: boolean;
  showSafeGuides: boolean;
  telemetryCount: number;
  bridge: DeterministicFrameBridge;
  onToggleHudType: (type: string) => void;
  onChangeAspectRatio: (ratio: VideoExportJobSpec["aspect_ratio"]) => void;
  onToggleAutoReflowVertical: () => void;
  onToggleSafeGuides: () => void;
  onGenerateStoryboardFromEvents: (scriptLines: string[]) => void;
  onUpdateKeyframeFallback: (
    keyframeId: string,
    fallback: NonNullable<DirectorKeyframe["topology_change_fallback"]>,
  ) => void;
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
  const [scriptText, setScriptText] = useState(
    "公元928年，德莱木军沿里海南岸推进。\n雷伊与加兹温易手，萨曼与齐亚尔边界重塑。",
  );
  const [faults, setFaults] = useState<DeterministicFaultFlags>({});
  const [stepResult, setStepResult] = useState<StepFrameResult | null>(null);
  const [exportStatus, setExportStatus] = useState<{
    state: "IDLE" | "BLOCKED" | "SUBMITTED";
    message: string;
    spec?: VideoExportJobSpec;
  }>({ state: "IDLE", message: "" });

  const transitionCheck = props.bundle.diff_record
    ? classifyTopologyTransition(
        props.bundle.diff_record.before_snapshot,
        props.bundle.diff_record.after_snapshot,
      )
    : null;

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
      auto_generate_srt: autoSrt,
      auto_generate_bibliography_credits: autoBib,
    };

    setExportStatus({
      state: "SUBMITTED",
      message: `已通过 G5 帧同步与安全区校验，生成 ${spec.aspect_ratio} ${spec.resolution} @ ${spec.fps}fps (${spec.output_format}) 导出规格。`,
      spec,
    });
  };

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="视频导播室与确定性导出面板">
      <div className="modal-card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <strong style={{ fontSize: 15 }}>内置历史地图视频导播室 · 确定性导出 (G5)</strong>
          <button type="button" className="studio-btn" onClick={props.onClose}>
            关闭
          </button>
        </div>

        {/* Storyboard & Telemetry Summary */}
        <div className="panel-section">
          <h3 className="panel-title">
            <span>AI 文案自动导播 & 60Hz 遥测 ({props.telemetryCount} 帧样本 → {props.keyframes.length} 关键帧)</span>
          </h3>
          <textarea
            className="studio-input"
            rows={2}
            value={scriptText}
            onChange={(e) => setScriptText(e.target.value)}
          />
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <button
              type="button"
              className="studio-btn active"
              onClick={() => props.onGenerateStoryboardFromEvents(scriptText.split(/\n+/).filter(Boolean))}
            >
              依据时间轴事件与文案生成分镜
            </button>
            {transitionCheck && (
              <span className="badge-pill badge-t2">{transitionCheck.reason_zh}</span>
            )}
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 4, maxHeight: 130, overflowY: "auto" }}>
            {props.keyframes.map((kf) => (
              <div
                key={kf.keyframe_id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 8,
                  fontSize: 11,
                  padding: "4px 6px",
                  background: "rgba(15,23,42,0.7)",
                  borderRadius: 4,
                }}
              >
                <span>
                  {kf.keyframe_id} · t={kf.video_time_sec}s · JDN {kf.historical_jdn.toFixed(1)} · zoom {kf.camera.zoom}
                </span>
                <div style={{ display: "flex", gap: 6 }}>
                  <select
                    aria-label={`关键帧 ${kf.keyframe_id} 拓扑突变过渡`}
                    className="studio-select"
                    style={{ fontSize: 10, padding: "2px 5px" }}
                    value={kf.topology_change_fallback ?? "OCCUPATION_RIPPLE"}
                    onChange={(e) =>
                      props.onUpdateKeyframeFallback(
                        kf.keyframe_id,
                        e.target.value as NonNullable<DirectorKeyframe["topology_change_fallback"]>,
                      )
                    }
                  >
                    <option value="OCCUPATION_RIPPLE">OCCUPATION_RIPPLE</option>
                    <option value="WIPE_MASK">WIPE_MASK</option>
                    <option value="CROSS_DISSOLVE">CROSS_DISSOLVE</option>
                  </select>
                  <button
                    type="button"
                    className="studio-btn"
                    style={{ fontSize: 10, padding: "2px 6px" }}
                    onClick={() => props.onPreviewKeyframe(kf)}
                  >
                    定位回放
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* 7 HUD Widgets & 9:16 Safe Area Controls */}
        <div className="panel-section">
          <h3 className="panel-title">
            <span>7 类影视级 HUD 挂件与竖屏 9:16 安全区检查</span>
            <span className={`badge-pill ${props.hudLayout.g5_hud_gate.passed ? "badge-t1" : "badge-error"}`}>
              HUD 安全区 {props.hudLayout.g5_hud_gate.passed ? "PASS" : "VIOLATION"}
            </span>
          </h3>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 5, fontSize: 11 }}>
            {ALL_HUD_TYPES.map((item) => (
              <label key={item.type} style={{ display: "flex", alignItems: "center", gap: 5 }}>
                <input
                  type="checkbox"
                  checked={props.enabledHudTypes.has(item.type)}
                  onChange={() => props.onToggleHudType(item.type)}
                />
                <span>{item.label}</span>
              </label>
            ))}
          </div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", fontSize: 11 }}>
            <label style={{ display: "flex", alignItems: "center", gap: 5 }}>
              <input
                type="checkbox"
                checked={props.autoReflowVertical}
                onChange={props.onToggleAutoReflowVertical}
              />
              <span>9:16 竖屏自动折叠/重排侧栏至安全区</span>
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: 5 }}>
              <input type="checkbox" checked={props.showSafeGuides} onChange={props.onToggleSafeGuides} />
              <span>显示抖音/B站竖屏遮挡参考线</span>
            </label>
          </div>
        </div>

        {/* A-42 Deterministic Step-Frame & Fault Injection Verification */}
        <div className="panel-section">
          <h3 className="panel-title">
            <span>确定性帧步进 (`window.__STEP_FRAME__`) 与 G5 故障注入测试 (A-42)</span>
          </h3>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", fontSize: 11 }}>
            <label style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <input
                type="checkbox"
                checked={Boolean(faults.force_map_not_idle)}
                onChange={(e) => setFaults((f) => ({ ...f, force_map_not_idle: e.target.checked }))}
              />
              注入 map_idle=false
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <input
                type="checkbox"
                checked={Boolean(faults.force_fonts_not_loaded)}
                onChange={(e) => setFaults((f) => ({ ...f, force_fonts_not_loaded: e.target.checked }))}
              />
              注入 fonts_loaded=false
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <input
                type="checkbox"
                checked={Boolean(faults.force_shaders_not_ready)}
                onChange={(e) => setFaults((f) => ({ ...f, force_shaders_not_ready: e.target.checked }))}
              />
              注入 shaders_ready=false
            </label>
            <button type="button" className="studio-btn" onClick={() => void runDeterministicSmoke()}>
              执行单帧 G5 校验
            </button>
          </div>
          {stepResult && (
            <div
              className="quote-box"
              style={{ borderLeftColor: stepResult.accepted ? "#10b981" : "#ef4444" }}
            >
              <div>
                帧 #{stepResult.frame_index} (t={stepResult.time_ms}ms, rev={stepResult.revision_id}) →{" "}
                <strong>{stepResult.accepted ? "READY & PASSED" : "REJECTED BY G5"}</strong>
              </div>
              {!stepResult.accepted && (
                <div style={{ color: "#fecaca", fontSize: 11 }}>
                  {stepResult.g5_gate.issues.map((i) => `${i.code}: ${i.message}`).join("；")}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Export Job Configuration */}
        <div className="panel-section">
          <h3 className="panel-title">导出参数 (VideoExportJobSpec)</h3>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <select
              aria-label="导出画幅"
              className="studio-select"
              value={props.aspectRatio}
              onChange={(e) => props.onChangeAspectRatio(e.target.value as VideoExportJobSpec["aspect_ratio"])}
            >
              <option value="16:9">16:9 横屏</option>
              <option value="9:16">9:16 竖屏</option>
              <option value="1:1">1:1 方屏</option>
              <option value="21:9">21:9 电影宽屏</option>
            </select>

            <select
              aria-label="导出分辨率"
              className="studio-select"
              value={resolution}
              onChange={(e) => setResolution(e.target.value as VideoExportJobSpec["resolution"])}
            >
              <option value="1080p">1080p</option>
              <option value="1440p">1440p</option>
              <option value="4K">4K</option>
            </select>

            <select
              aria-label="导出帧率"
              className="studio-select"
              value={fps}
              onChange={(e) => setFps(Number(e.target.value) as VideoExportJobSpec["fps"])}
            >
              <option value={30}>30 fps</option>
              <option value={60}>60 fps</option>
            </select>

            <select
              aria-label="导出封装格式"
              className="studio-select"
              value={outputFormat}
              onChange={(e) => setOutputFormat(e.target.value as VideoExportJobSpec["output_format"])}
            >
              <option value="MP4_H264">MP4 (H.264)</option>
              <option value="MP4_HEVC">MP4 (HEVC)</option>
              <option value="WEBM_ALPHA">WebM (Alpha 透明分层)</option>
              <option value="PRORES_4444">ProRes 4444 (Alpha 分层)</option>
              <option value="INTERACTIVE_WEB_BUNDLE">交互式网页播放器包</option>
            </select>

            <label style={{ fontSize: 11, display: "flex", alignItems: "center", gap: 4 }}>
              <input type="checkbox" checked={autoSrt} onChange={(e) => setAutoSrt(e.target.checked)} />
              导出 .srt 字幕
            </label>
            <label style={{ fontSize: 11, display: "flex", alignItems: "center", gap: 4 }}>
              <input type="checkbox" checked={autoBib} onChange={(e) => setAutoBib(e.target.checked)} />
              导出 T1 参考文献附录
            </label>

            <button type="button" className="studio-btn active" onClick={() => void handleSubmitExport()}>
              校验并提交导出任务
            </button>
          </div>

          {exportStatus.state !== "IDLE" && (
            <div
              className="quote-box"
              style={{ borderLeftColor: exportStatus.state === "BLOCKED" ? "#ef4444" : "#34d399" }}
            >
              <div>{exportStatus.message}</div>
              {exportStatus.spec && (
                <pre style={{ margin: "6px 0 0", fontSize: 10, overflowX: "auto", color: "#93c5fd" }}>
                  {JSON.stringify(
                    {
                      project_id: exportStatus.spec.project_id,
                      aspect_ratio: exportStatus.spec.aspect_ratio,
                      resolution: exportStatus.spec.resolution,
                      fps: exportStatus.spec.fps,
                      output_format: exportStatus.spec.output_format,
                      keyframes_count: exportStatus.spec.keyframes.length,
                      hud_widgets_count: exportStatus.spec.hud_widgets.length,
                      artifacts: [
                        `video.${outputFormat.toLowerCase()}`,
                        ...(autoSrt ? ["subtitles.srt", "chapters.txt"] : []),
                        ...(autoBib ? ["t1_bibliography_credits.json"] : []),
                      ],
                    },
                    null,
                    2,
                  )}
                </pre>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
