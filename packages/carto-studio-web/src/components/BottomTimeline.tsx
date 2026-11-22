import { useEffect, useMemo, useRef, useState } from "react";
import type {
  DirectorKeyframe,
  HistoricalEvent,
  TimeGranularity,
} from "@historical-cartography/shared-schema";
import type { PaletteSolveReport } from "../core/color/ciede2000.ts";
import type { EpochSceneBundle, HistoricalFigure } from "../core/data/demo-types.ts";
import {
  DEFAULT_DYNASTY_BANDS,
  formatJdnLabel,
  generateTimelineTicks,
  jdnToScreenRatio,
  screenRatioToJdn,
  type TimelineViewport,
} from "../core/director/timeline-math.ts";
import { PALETTE_THEMES } from "../core/styles/style-presets.ts";

export interface BottomTimelineProps {
  bundle: EpochSceneBundle;
  allBundles: readonly EpochSceneBundle[];
  viewport: TimelineViewport;
  keyframes: DirectorKeyframe[];
  selectedKeyframeId?: string | undefined;
  directorExpanded: boolean;
  directorTimeSec: number;
  totalDurationSec: number;
  isPlaying: boolean;
  playbackRate: number;
  isRecording60Hz: boolean;
  audioNarrationUri?: string | undefined;
  paletteId: string;
  autoFourColor: boolean;
  paletteReport: PaletteSolveReport;
  opacityMultiplier: number;
  saturationMultiplier: number;
  spotlightPolityId?: string | undefined;
  onChangeViewport: (next: TimelineViewport) => void;
  onPanTimeline: (deltaRatio: number) => void;
  onZoomWheel: (anchorRatio: number, deltaY: number) => void;
  onSelectGranularity: (granularity: TimeGranularity) => void;
  onResetFullTimeline: () => void;
  onSelectEvent: (event: HistoricalEvent) => void;
  onSelectFigure: (figure: HistoricalFigure) => void;
  onSelectKeyframe: (kf: DirectorKeyframe) => void;
  onAddKeyframe: () => void;
  onDeleteKeyframe: (keyframeId: string) => void;
  onMoveKeyframeTime: (keyframeId: string, nextVideoTimeSec: number) => void;
  onScrubDirectorTime: (videoTimeSec: number) => void;
  onTogglePlay: () => void;
  onChangePlaybackRate: (rate: number) => void;
  onStepEpoch: (direction: -1 | 1) => void;
  onToggleRecord60Hz: () => void;
  onOpenExportModal: () => void;
  onToggleDirectorExpanded: () => void;
  onSelectPaletteTheme: (paletteId: string) => void;
  onToggleAutoFourColor: () => void;
  onOverridePolityColor: (polityId: string, hex: string) => void;
  onResetPolityOverrides: () => void;
  onChangeOpacityMultiplier: (value: number) => void;
  onChangeSaturationMultiplier: (value: number) => void;
  onHoverPolity: (polityId?: string) => void;
}

const GRANULARITY_BUTTONS: Array<{ key: TimeGranularity; label: string }> = [
  { key: "CENTURY", label: "千年/世纪" },
  { key: "DECADE", label: "朝代/十年" },
  { key: "YEAR", label: "年份" },
  { key: "MONTH", label: "月度" },
  { key: "DAY", label: "战役日" },
  { key: "HOUR", label: "小时战术" },
];

const EVENT_COLORS: Record<HistoricalEvent["event_category"], string> = {
  WAR_BATTLE: "#dc2626",
  TERRITORY_TRANSFER: "#d97706",
  TREATY: "#0891b2",
  FOUNDING: "#7c3aed",
  ADMIN_REFORM: "#059669",
  OTHER: "#475569",
};

export function BottomTimeline(props: BottomTimelineProps) {
  const tracksRef = useRef<HTMLDivElement | null>(null);
  const videoLaneRef = useRef<HTMLDivElement | null>(null);
  const [hoveredEvent, setHoveredEvent] = useState<HistoricalEvent | null>(null);
  const [dragState, setDragState] = useState<
    | { mode: "scrub" }
    | { mode: "pan"; startX: number; width: number }
    | { mode: "kf"; kfId: string }
    | null
  >(null);

  const ticks = useMemo(() => generateTimelineTicks(props.viewport, 7), [props.viewport]);
  const cursorRatio = Math.max(0, Math.min(1, jdnToScreenRatio(props.viewport.cursor_jdn, props.viewport)));
  const durationSec = Math.max(4, props.totalDurationSec);

  // Deduplicated figures & events across all epoch bundles
  const allFigures = useMemo(() => {
    const map = new Map<string, HistoricalFigure>();
    for (const b of props.allBundles) {
      for (const fig of b.figures) {
        if (!map.has(fig.figure_id)) map.set(fig.figure_id, fig);
      }
    }
    return [...map.values()];
  }, [props.allBundles]);

  const allEvents = useMemo(() => {
    const map = new Map<string, HistoricalEvent>();
    for (const b of props.allBundles) {
      for (const ev of b.events) {
        if (!map.has(ev.hist_event_id)) map.set(ev.hist_event_id, ev);
      }
    }
    return [...map.values()].sort((a, b) => a.time_start.julian_day_number - b.time_start.julian_day_number);
  }, [props.allBundles]);

  const polityNameMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const b of props.allBundles) {
      for (const p of b.polities) m.set(p.polity_id, p.name_zh);
    }
    return m;
  }, [props.allBundles]);

  // Native non-passive wheel zoom so page never scrolls unexpectedly
  useEffect(() => {
    const el = tracksRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const ratio = rect.width > 96 ? (e.clientX - rect.left - 96) / (rect.width - 96) : 0.5;
      props.onZoomWheel(Math.max(0, Math.min(1, ratio)), e.deltaY);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [props.onZoomWheel]);

  // Pointer scrubbing / panning / keyframe dragging
  useEffect(() => {
    if (!dragState) return;
    const onMove = (e: PointerEvent) => {
      if (dragState.mode === "kf" && videoLaneRef.current) {
        const rect = videoLaneRef.current.getBoundingClientRect();
        if (rect.width > 0) {
          const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
          props.onMoveKeyframeTime(dragState.kfId, Number((ratio * durationSec).toFixed(2)));
        }
        return;
      }
      if (!tracksRef.current) return;
      const rect = tracksRef.current.getBoundingClientRect();
      const laneW = Math.max(1, rect.width - 96);
      if (dragState.mode === "scrub") {
        const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left - 96) / laneW));
        props.onChangeViewport({ ...props.viewport, cursor_jdn: screenRatioToJdn(ratio, props.viewport) });
      } else if (dragState.mode === "pan") {
        const dx = e.clientX - dragState.startX;
        dragState.startX = e.clientX;
        props.onPanTimeline(-dx / laneW);
      }
    };
    const onUp = () => setDragState(null);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [dragState, props, durationSec]);

  const startLaneScrubOrPan = (e: React.PointerEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    if (rect.width <= 0) return;
    if (e.shiftKey) {
      setDragState({ mode: "pan", startX: e.clientX, width: rect.width });
      return;
    }
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    props.onChangeViewport({ ...props.viewport, cursor_jdn: screenRatioToJdn(ratio, props.viewport) });
    setDragState({ mode: "scrub" });
  };

  return (
    <section className="bottom-dock" aria-label="底部四轨时空时间轴与实时调色栏">
      {/* Live Palette, Opacity/Saturation & CIEDE2000 Anti-Collision Bar */}
      <div className="palette-strip">
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
          <strong style={{ color: "#e2e8f0" }}>调色与继承</strong>
          <select
            aria-label="主题色盘"
            className="studio-select"
            style={{ padding: "2px 6px", fontSize: 11 }}
            value={props.paletteId}
            onChange={(e) => props.onSelectPaletteTheme(e.target.value)}
          >
            {Object.entries(PALETTE_THEMES).map(([id, theme]) => (
              <option key={id} value={id}>
                {theme.label_zh}
              </option>
            ))}
          </select>

          <label style={{ display: "inline-flex", alignItems: "center", gap: 4, cursor: "pointer" }}>
            <input type="checkbox" checked={props.autoFourColor} onChange={props.onToggleAutoFourColor} />
            <span>四色防撞</span>
          </label>

          <button
            type="button"
            className="studio-btn"
            style={{ padding: "2px 7px", fontSize: 10 }}
            onClick={props.onResetPolityOverrides}
          >
            恢复自动四色
          </button>

          <span
            className={`badge-pill ${props.paletteReport.all_adjacent_clear ? "badge-t1" : "badge-dispute"}`}
            title={`拓扑邻接政权最小 CIEDE2000 色差 ΔE = ${props.paletteReport.min_measured_delta_e}`}
          >
            min ΔE₀₀ = {props.paletteReport.min_measured_delta_e.toFixed(1)}
          </span>

          <label style={{ display: "inline-flex", alignItems: "center", gap: 4, color: "#cbd5e1" }}>
            <span>透明 {props.opacityMultiplier.toFixed(2)}</span>
            <input
              type="range"
              min={0.3}
              max={1.4}
              step={0.05}
              style={{ width: 64 }}
              value={props.opacityMultiplier}
              onChange={(e) => props.onChangeOpacityMultiplier(Number(e.target.value))}
            />
          </label>
          <label style={{ display: "inline-flex", alignItems: "center", gap: 4, color: "#cbd5e1" }}>
            <span>饱和 {props.saturationMultiplier.toFixed(2)}</span>
            <input
              type="range"
              min={0.2}
              max={1.6}
              step={0.05}
              style={{ width: 64 }}
              value={props.saturationMultiplier}
              onChange={(e) => props.onChangeSaturationMultiplier(Number(e.target.value))}
            />
          </label>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          {Object.entries(props.paletteReport.colors_by_polity).map(([polityId, hex]) => {
            const meta = props.bundle.polities.find((p) => p.polity_id === polityId);
            const inherited = props.paletteReport.inherited_polities.includes(polityId);
            const parentName = meta?.parent_polity_id ? polityNameMap.get(meta.parent_polity_id) : undefined;
            return (
              <label
                key={polityId}
                className="swatch-chip"
                title={parentName ? `继承同色系母政权：${parentName}` : meta?.name_zh ?? polityId}
                onMouseEnter={() => props.onHoverPolity(polityId)}
                onMouseLeave={() => props.onHoverPolity(undefined)}
                style={{ borderColor: props.spotlightPolityId === polityId ? "#38bdf8" : undefined, cursor: "pointer" }}
              >
                <input
                  type="color"
                  value={hex}
                  onChange={(e) => props.onOverridePolityColor(polityId, e.target.value)}
                  style={{ width: 13, height: 13, padding: 0, border: "none", background: "transparent", cursor: "pointer" }}
                />
                <span>{meta?.name_zh ?? polityId}</span>
                {inherited && <small style={{ color: "#38bdf8" }}>↳{parentName ?? "同系"}</small>}
              </label>
            );
          })}
        </div>
      </div>

      {/* Elastic Zoomable 4-Track Timeline */}
      <div className="timeline-panel">
        <div className="timeline-controls">
          <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
            <button type="button" className="studio-btn" style={{ padding: "2px 6px", fontSize: 10 }} onClick={() => props.onStepEpoch(-1)}>
              ◀ 上一时期
            </button>
            <button
              type="button"
              className={`studio-btn ${props.isPlaying ? "active" : ""}`}
              style={{ padding: "2px 8px", fontSize: 10 }}
              onClick={props.onTogglePlay}
            >
              {props.isPlaying ? "⏸ 暂停演进" : "▶ 播放演进"}
            </button>
            <button type="button" className="studio-btn" style={{ padding: "2px 6px", fontSize: 10 }} onClick={() => props.onStepEpoch(1)}>
              下一时期 ▶
            </button>
            <select
              aria-label="播放倍速"
              className="studio-select"
              style={{ padding: "2px 5px", fontSize: 10 }}
              value={props.playbackRate}
              onChange={(e) => props.onChangePlaybackRate(Number(e.target.value))}
            >
              <option value={0.5}>0.5x</option>
              <option value={1}>1x</option>
              <option value={2}>2x</option>
              <option value={4}>4x</option>
            </select>
            <strong style={{ color: "#fbbf24" }}>{formatJdnLabel(props.viewport.cursor_jdn, props.viewport.granularity)}</strong>
            <span style={{ color: "#94a3b8" }}>({props.bundle.calendar_era_note} · JDN {props.viewport.cursor_jdn.toFixed(2)})</span>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 4, flexWrap: "wrap" }}>
            <button type="button" className="studio-btn" style={{ padding: "2px 6px", fontSize: 10 }} onClick={() => props.onPanTimeline(-0.22)}>
              ← 左移
            </button>
            <button type="button" className="studio-btn" style={{ padding: "2px 6px", fontSize: 10 }} onClick={() => props.onPanTimeline(0.22)}>
              右移 →
            </button>
            {GRANULARITY_BUTTONS.map((btn) => (
              <button
                key={btn.key}
                type="button"
                className={`studio-btn ${props.viewport.granularity === btn.key ? "active" : ""}`}
                style={{ padding: "2px 6px", fontSize: 10 }}
                onClick={() => props.onSelectGranularity(btn.key)}
              >
                {btn.label}
              </button>
            ))}
            <button type="button" className="studio-btn" style={{ padding: "2px 6px", fontSize: 10 }} onClick={props.onResetFullTimeline}>
              全览重置
            </button>
            <button
              type="button"
              className={`studio-btn ${props.isRecording60Hz ? "active" : ""}`}
              style={{ padding: "2px 7px", fontSize: 10, borderColor: props.isRecording60Hz ? "#ef4444" : undefined }}
              onClick={props.onToggleRecord60Hz}
            >
              {props.isRecording60Hz ? "● 停止60Hz录制" : "● 录制推演"}
            </button>
            <button
              type="button"
              className={`studio-btn ${props.directorExpanded ? "active" : ""}`}
              style={{ padding: "2px 7px", fontSize: 10 }}
              onClick={props.onToggleDirectorExpanded}
            >
              {props.directorExpanded ? "收起导播轨" : `导播轨 (${props.keyframes.length})`}
            </button>
            <button type="button" className="studio-btn" style={{ padding: "2px 7px", fontSize: 10 }} onClick={props.onOpenExportModal}>
              导出
            </button>
          </div>
        </div>

        <div className="timeline-tracks-wrap" ref={tracksRef} onDoubleClick={props.onResetFullTimeline}>
          {/* Unclipped cursor bubble floating cleanly above track bounds */}
          <div
            style={{
              position: "absolute",
              top: 0,
              left: `calc(96px + (100% - 96px) * ${cursorRatio.toFixed(4)})`,
              transform: "translateX(-50%)",
              padding: "2px 8px",
              borderRadius: 4,
              background: "rgba(251, 191, 36, 0.96)",
              color: "#1e293b",
              fontSize: 11,
              fontWeight: 800,
              whiteSpace: "nowrap",
              pointerEvents: "none",
              zIndex: 8,
              boxShadow: "0 2px 8px rgba(0,0,0,0.4)",
            }}
          >
            {formatJdnLabel(props.viewport.cursor_jdn, props.viewport.granularity)}
          </div>

          {/* Rich event hover preview */}
          {hoveredEvent && (
            <div
              style={{
                position: "absolute",
                right: 12,
                bottom: "calc(100% + 6px)",
                maxWidth: 360,
                padding: "8px 10px",
                background: "rgba(15, 23, 42, 0.96)",
                border: "1px solid rgba(56, 189, 248, 0.45)",
                borderRadius: 6,
                fontSize: 11,
                zIndex: 20,
                pointerEvents: "none",
                boxShadow: "0 8px 24px rgba(0,0,0,0.5)",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8, fontWeight: 700, color: "#f8fafc" }}>
                <span>{hoveredEvent.title}</span>
                <span style={{ color: "#fbbf24" }}>{hoveredEvent.time_start.historical_year_display}</span>
              </div>
              <div style={{ color: "#cbd5e1", marginTop: 3 }}>{hoveredEvent.summary}</div>
              {hoveredEvent.citations[0] && (
                <div style={{ color: "#94a3b8", marginTop: 4, fontStyle: "italic" }}>
                  “{hoveredEvent.citations[0].verbatim_quote.slice(0, 72)}...”
                </div>
              )}
            </div>
          )}

          <div className="timeline-tracks">
            {/* Shared vertical cursor hairline */}
            <div
              className="timeline-cursor-line"
              style={{ left: `calc(96px + (100% - 96px) * ${cursorRatio.toFixed(4)})` }}
            />

            {/* Ruler row */}
            <div className="track-row" style={{ height: 18, background: "rgba(15, 23, 42, 0.98)" }}>
              <div className="track-label">标尺 · {props.viewport.granularity}</div>
              <div className="track-lane" onPointerDown={startLaneScrubOrPan} style={{ cursor: "ew-resize" }}>
                {ticks.map((tick, idx) => (
                  <div
                    key={`${tick.jdn}-${idx}`}
                    style={{
                      position: "absolute",
                      left: `${(tick.ratio * 100).toFixed(2)}%`,
                      top: 0,
                      bottom: 0,
                      borderLeft: "1px solid rgba(148,163,184,0.35)",
                      paddingLeft: 4,
                      fontSize: 9,
                      color: "#94a3b8",
                      whiteSpace: "nowrap",
                      display: "flex",
                      alignItems: "center",
                    }}
                  >
                    {tick.label}
                  </div>
                ))}
              </div>
            </div>

            {/* Track 1: Dynasty & Parallel Era bands (strict focus_jdn jump!) */}
            <div className="track-row">
              <div className="track-label">1. 朝代与年号</div>
              <div className="track-lane" onPointerDown={startLaneScrubOrPan}>
                {DEFAULT_DYNASTY_BANDS.map((band) => {
                  const startR = jdnToScreenRatio(band.valid_from_jdn, props.viewport);
                  const endR = jdnToScreenRatio(band.valid_to_jdn, props.viewport);
                  if (endR < 0 || startR > 1) return null;
                  const clampedLeft = Math.max(0, startR);
                  const widthPct = Math.max(3, (Math.min(1, endR) - clampedLeft) * 100);
                  const parallelTip = band.parallel_eras?.map((pe) => `${pe.polity_zh}:${pe.era_text}`).join(" | ");
                  return (
                    <button
                      key={band.band_id}
                      type="button"
                      onPointerDown={(ev) => ev.stopPropagation()}
                      onClick={(ev) => {
                        ev.stopPropagation();
                        props.onChangeViewport({ ...props.viewport, cursor_jdn: band.focus_jdn });
                      }}
                      title={parallelTip ? `${band.era_note} (${parallelTip})` : band.era_note}
                      style={{
                        position: "absolute",
                        left: `${(clampedLeft * 100).toFixed(2)}%`,
                        width: `${widthPct.toFixed(2)}%`,
                        top: 3,
                        bottom: 3,
                        borderRadius: 4,
                        border: "1px solid rgba(255,255,255,0.28)",
                        background: band.color_hex,
                        color: "#fff",
                        fontSize: 10,
                        fontWeight: 600,
                        overflow: "hidden",
                        whiteSpace: "nowrap",
                        textOverflow: "ellipsis",
                        padding: "0 5px",
                        cursor: "pointer",
                        opacity: 0.9,
                      }}
                    >
                      {band.label_zh}
                      {parallelTip ? ` · ${band.parallel_eras?.[0]?.era_text ?? ""}` : ""}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Track 2: Global Figures across all epochs */}
            <div className="track-row">
              <div className="track-label">2. 跨代人物</div>
              <div className="track-lane">
                {allFigures.map((fig) => {
                  const r0 = jdnToScreenRatio(fig.active_from_jdn, props.viewport);
                  const r1 = jdnToScreenRatio(fig.active_to_jdn, props.viewport);
                  if (r1 < 0 || r0 > 1) return null;
                  const leftPct = Math.max(0, r0) * 100;
                  const widthPct = Math.max(2.5, (Math.min(1, r1) - Math.max(0, r0)) * 100);
                  return (
                    <button
                      key={fig.figure_id}
                      type="button"
                      onClick={() => props.onSelectFigure(fig)}
                      title={`${fig.name_zh}（${fig.title}）`}
                      style={{
                        position: "absolute",
                        left: `${leftPct.toFixed(2)}%`,
                        width: `${widthPct.toFixed(2)}%`,
                        top: 4,
                        bottom: 4,
                        borderRadius: 999,
                        border: "1px solid rgba(255,255,255,0.35)",
                        background: fig.accent_hex,
                        color: "#fff",
                        fontSize: 10,
                        fontWeight: 600,
                        padding: "0 6px",
                        cursor: "pointer",
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                      }}
                    >
                      {fig.name_zh}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Track 3: Global Events grouped by event_category */}
            <div className="track-row">
              <div className="track-label">3. 全轴事件</div>
              <div className="track-lane">
                {allEvents.map((ev) => {
                  const r = jdnToScreenRatio(ev.time_start.julian_day_number, props.viewport);
                  if (r < 0 || r > 1) return null;
                  return (
                    <button
                      key={ev.hist_event_id}
                      type="button"
                      onMouseEnter={() => setHoveredEvent(ev)}
                      onMouseLeave={() => setHoveredEvent((prev) => (prev?.hist_event_id === ev.hist_event_id ? null : prev))}
                      onClick={() => props.onSelectEvent(ev)}
                      style={{
                        position: "absolute",
                        left: `${(r * 100).toFixed(2)}%`,
                        transform: "translateX(-50%)",
                        top: 3,
                        bottom: 3,
                        borderRadius: 4,
                        border: "1px solid rgba(255,255,255,0.45)",
                        background: EVENT_COLORS[ev.event_category] ?? "#0284c7",
                        color: "#f8fafc",
                        fontSize: 10,
                        fontWeight: 600,
                        padding: "0 6px",
                        whiteSpace: "nowrap",
                        cursor: "pointer",
                      }}
                    >
                      ◆ {ev.title}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Track 4: Video-Time Keyframes (draggable) & Audio Track */}
            {props.directorExpanded && (
              <div className="track-row" style={{ height: 34, background: "rgba(30, 41, 59, 0.72)" }}>
                <div className="track-label" style={{ gap: 4 }}>
                  <span>4. 导播</span>
                  <button
                    type="button"
                    className="studio-btn"
                    style={{ padding: "1px 4px", fontSize: 9 }}
                    onClick={props.onAddKeyframe}
                    title="在当前时间添加关键帧"
                  >
                    +帧
                  </button>
                  {props.selectedKeyframeId && props.keyframes.length > 2 && (
                    <button
                      type="button"
                      className="studio-btn"
                      style={{ padding: "1px 4px", fontSize: 9 }}
                      onClick={() => props.onDeleteKeyframe(props.selectedKeyframeId!)}
                      title="删除选中关键帧"
                    >
                      -帧
                    </button>
                  )}
                </div>
                <div
                  ref={videoLaneRef}
                  className="track-lane"
                  style={{ cursor: "pointer" }}
                  onClick={(e) => {
                    const rect = e.currentTarget.getBoundingClientRect();
                    if (rect.width > 0) {
                      const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
                      props.onScrubDirectorTime(Number((ratio * durationSec).toFixed(2)));
                    }
                  }}
                >
                  {/* Video playhead */}
                  <div
                    style={{
                      position: "absolute",
                      top: 0,
                      bottom: 0,
                      left: `${Math.max(0, Math.min(100, (props.directorTimeSec / durationSec) * 100)).toFixed(2)}%`,
                      width: 2,
                      background: "#ef4444",
                      pointerEvents: "none",
                      zIndex: 4,
                    }}
                  />
                  {/* Audio narration lane strip */}
                  <div
                    style={{
                      position: "absolute",
                      left: 0,
                      right: 0,
                      bottom: 2,
                      height: 8,
                      background: props.audioNarrationUri ? "rgba(16, 185, 129, 0.35)" : "rgba(148, 163, 184, 0.14)",
                      fontSize: 8,
                      lineHeight: "8px",
                      color: "#a7f3d0",
                      paddingLeft: 6,
                    }}
                  >
                    {props.audioNarrationUri ? `♫ 配音轨: ${props.audioNarrationUri}` : "无配音轨"}
                  </div>
                  {props.keyframes.map((kf, idx) => {
                    const vr = Math.max(0, Math.min(1, kf.video_time_sec / durationSec));
                    const isSel = kf.keyframe_id === props.selectedKeyframeId;
                    return (
                      <button
                        key={kf.keyframe_id}
                        type="button"
                        onPointerDown={(e) => {
                          e.stopPropagation();
                          props.onSelectKeyframe(kf);
                          setDragState({ mode: "kf", kfId: kf.keyframe_id });
                        }}
                        title={`KF${idx + 1} @ ${kf.video_time_sec.toFixed(1)}s (${kf.easing})`}
                        style={{
                          position: "absolute",
                          left: `${(vr * 100).toFixed(2)}%`,
                          transform: "translateX(-50%)",
                          top: 2,
                          height: 18,
                          borderRadius: 4,
                          border: isSel ? "1.5px solid #38bdf8" : "1px solid #f59e0b",
                          background: isSel ? "rgba(56, 189, 248, 0.32)" : "rgba(245, 158, 11, 0.24)",
                          color: "#fef3c7",
                          fontSize: 9,
                          padding: "0 5px",
                          cursor: "ew-resize",
                          whiteSpace: "nowrap",
                        }}
                      >
                        ◇ {kf.video_time_sec.toFixed(1)}s
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
