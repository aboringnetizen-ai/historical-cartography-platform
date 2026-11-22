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
  viewport: TimelineViewport;
  keyframes: DirectorKeyframe[];
  directorExpanded: boolean;
  paletteId: string;
  autoFourColor: boolean;
  paletteReport: PaletteSolveReport;
  spotlightPolityId?: string | undefined;
  onChangeViewport: (next: TimelineViewport) => void;
  onZoomWheel: (anchorRatio: number, deltaY: number) => void;
  onSelectGranularity: (granularity: TimeGranularity) => void;
  onResetFullTimeline: () => void;
  onSelectEvent: (event: HistoricalEvent) => void;
  onSelectFigure: (figure: HistoricalFigure) => void;
  onSelectKeyframe: (kf: DirectorKeyframe) => void;
  onToggleDirectorExpanded: () => void;
  onSelectPaletteTheme: (paletteId: string) => void;
  onToggleAutoFourColor: () => void;
  onOverridePolityColor: (polityId: string, hex: string) => void;
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

export function BottomTimeline(props: BottomTimelineProps) {
  const ticks = generateTimelineTicks(props.viewport, 7);
  const cursorRatio = Math.max(0, Math.min(1, jdnToScreenRatio(props.viewport.cursor_jdn, props.viewport)));

  const handleLaneClick = (ev: React.MouseEvent<HTMLDivElement>) => {
    const rect = ev.currentTarget.getBoundingClientRect();
    if (rect.width <= 0) return;
    const ratio = (ev.clientX - rect.left) / rect.width;
    const nextJdn = screenRatioToJdn(ratio, props.viewport);
    props.onChangeViewport({ ...props.viewport, cursor_jdn: nextJdn });
  };

  return (
    <section className="bottom-dock" aria-label="底部四轨时空时间轴与实时调色栏">
      {/* Live Palette & CIEDE2000 Anti-Collision Bar */}
      <div className="palette-strip">
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <strong style={{ color: "#e2e8f0" }}>实时配色与防撞色</strong>
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
            <input
              type="checkbox"
              checked={props.autoFourColor}
              onChange={props.onToggleAutoFourColor}
            />
            <span>四色防撞求解</span>
          </label>

          <span
            className={`badge-pill ${props.paletteReport.all_adjacent_clear ? "badge-t1" : "badge-dispute"}`}
            title={`拓扑邻接政权最小 CIEDE2000 色差 ΔE = ${props.paletteReport.min_measured_delta_e}`}
          >
            邻接 min ΔE₀₀ = {props.paletteReport.min_measured_delta_e.toFixed(1)}
          </span>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          {Object.entries(props.paletteReport.colors_by_polity).map(([polityId, hex]) => {
            const meta = props.bundle.polities.find((p) => p.polity_id === polityId);
            const inherited = props.paletteReport.inherited_polities.includes(polityId);
            return (
              <label
                key={polityId}
                className="swatch-chip"
                onMouseEnter={() => props.onHoverPolity(polityId)}
                onMouseLeave={() => props.onHoverPolity(undefined)}
                style={{
                  borderColor: props.spotlightPolityId === polityId ? "#38bdf8" : undefined,
                  cursor: "pointer",
                }}
              >
                <input
                  type="color"
                  value={hex}
                  onChange={(e) => props.onOverridePolityColor(polityId, e.target.value)}
                  style={{ width: 14, height: 14, padding: 0, border: "none", background: "transparent", cursor: "pointer" }}
                />
                <span>{meta?.name_zh ?? polityId}</span>
                {inherited && <small style={{ color: "#38bdf8" }}>↳继承</small>}
              </label>
            );
          })}
        </div>
      </div>

      {/* Elastic Zoomable 4-Track Timeline */}
      <div className="timeline-panel">
        <div className="timeline-controls">
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <strong style={{ color: "#fbbf24" }}>
              {formatJdnLabel(props.viewport.cursor_jdn, props.viewport.granularity)}
            </strong>
            <span style={{ color: "#94a3b8" }}>
              ({props.bundle.calendar_era_note} · JDN {props.viewport.cursor_jdn.toFixed(2)})
            </span>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
            {GRANULARITY_BUTTONS.map((btn) => (
              <button
                key={btn.key}
                type="button"
                className={`studio-btn ${props.viewport.granularity === btn.key ? "active" : ""}`}
                style={{ padding: "2px 7px", fontSize: 10 }}
                onClick={() => props.onSelectGranularity(btn.key)}
              >
                {btn.label}
              </button>
            ))}
            <button
              type="button"
              className="studio-btn"
              style={{ padding: "2px 7px", fontSize: 10 }}
              onClick={props.onResetFullTimeline}
              title="双击轨道也可恢复千年全览"
            >
              全览重置
            </button>
            <button
              type="button"
              className={`studio-btn ${props.directorExpanded ? "active" : ""}`}
              style={{ padding: "2px 7px", fontSize: 10 }}
              onClick={props.onToggleDirectorExpanded}
            >
              {props.directorExpanded ? "收起导播轨" : `导播关键帧 (${props.keyframes.length})`}
            </button>
          </div>
        </div>

        <div
          className="timeline-tracks"
          onDoubleClick={props.onResetFullTimeline}
          onWheel={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            const ratio = rect.width > 96 ? (e.clientX - rect.left - 96) / (rect.width - 96) : 0.5;
            props.onZoomWheel(Math.max(0, Math.min(1, ratio)), e.deltaY);
          }}
        >
          {/* Ruler row */}
          <div className="track-row" style={{ height: 18, background: "rgba(15, 23, 42, 0.98)" }}>
            <div className="track-label">标尺 · {props.viewport.granularity}</div>
            <div className="track-lane" onClick={handleLaneClick} style={{ cursor: "pointer" }}>
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
              <div className="timeline-cursor-line" style={{ left: `${(cursorRatio * 100).toFixed(2)}%` }}>
                <div
                  style={{
                    position: "absolute",
                    top: -22,
                    left: "50%",
                    transform: "translateX(-50%)",
                    padding: "2px 8px",
                    borderRadius: 4,
                    background: "rgba(251, 191, 36, 0.95)",
                    color: "#1e293b",
                    fontSize: 11,
                    fontWeight: 800,
                    whiteSpace: "nowrap",
                    boxShadow: "0 2px 8px rgba(0,0,0,0.4)",
                  }}
                >
                  {formatJdnLabel(props.viewport.cursor_jdn, props.viewport.granularity)}
                </div>
              </div>
            </div>
          </div>

          {/* Track 1: Dynasty & Era */}
          <div className="track-row">
            <div className="track-label">1. 朝代与纪年</div>
            <div className="track-lane" onClick={handleLaneClick}>
              {DEFAULT_DYNASTY_BANDS.map((band) => {
                const startR = jdnToScreenRatio(band.valid_from_jdn, props.viewport);
                const endR = jdnToScreenRatio(band.valid_to_jdn, props.viewport);
                if (endR < 0 || startR > 1) return null;
                const clampedLeft = Math.max(0, startR);
                const clampedRight = Math.min(1, endR);
                const widthPct = Math.max(3, (clampedRight - clampedLeft) * 100);
                return (
                  <button
                    key={band.band_id}
                    type="button"
                    onClick={(ev) => {
                      ev.stopPropagation();
                      props.onChangeViewport({
                        ...props.viewport,
                        cursor_jdn: (band.valid_from_jdn + band.valid_to_jdn) / 2,
                      });
                    }}
                    title={band.era_note}
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
                      overflow: "hidden",
                      whiteSpace: "nowrap",
                      textOverflow: "ellipsis",
                      cursor: "pointer",
                      padding: "0 6px",
                    }}
                  >
                    {band.label_zh}
                  </button>
                );
              })}
              <div className="timeline-cursor-line" style={{ left: `${(cursorRatio * 100).toFixed(2)}%` }} />
            </div>
          </div>

          {/* Track 2: Historical Figures */}
          <div className="track-row">
            <div className="track-label">2. 历史人物</div>
            <div className="track-lane" onClick={handleLaneClick}>
              {props.bundle.figures.map((fig) => {
                const startR = jdnToScreenRatio(fig.active_from_jdn, props.viewport);
                const endR = jdnToScreenRatio(fig.active_to_jdn, props.viewport);
                if (endR < -0.05 || startR > 1.05) return null;
                const leftPct = Math.max(1, Math.min(94, startR * 100));
                return (
                  <button
                    key={fig.figure_id}
                    type="button"
                    onClick={(ev) => {
                      ev.stopPropagation();
                      props.onSelectFigure(fig);
                    }}
                    style={{
                      position: "absolute",
                      left: `${leftPct.toFixed(2)}%`,
                      top: 3,
                      bottom: 3,
                      borderRadius: 999,
                      border: "1px solid rgba(255,255,255,0.4)",
                      background: fig.accent_hex,
                      color: "#fff",
                      fontSize: 10,
                      padding: "0 7px",
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 4,
                      cursor: "pointer",
                      whiteSpace: "nowrap",
                    }}
                    title={fig.summary}
                  >
                    <strong>{fig.portrait_monogram}</strong>
                    <span>{fig.name_zh}</span>
                  </button>
                );
              })}
              <div className="timeline-cursor-line" style={{ left: `${(cursorRatio * 100).toFixed(2)}%` }} />
            </div>
          </div>

          {/* Track 3: Major Events */}
          <div className="track-row">
            <div className="track-label">3. 历史大事件</div>
            <div className="track-lane" onClick={handleLaneClick}>
              {props.bundle.events.map((event) => {
                const ratio = jdnToScreenRatio(event.time_start.julian_day_number, props.viewport);
                if (ratio < -0.02 || ratio > 1.02) return null;
                const badgeBg =
                  event.conflict_status === "CONSENSUS"
                    ? "#10b981"
                    : event.conflict_status === "T1_SCHOLARLY_DISPUTE"
                      ? "#f59e0b"
                      : "#ef4444";
                return (
                  <button
                    key={event.hist_event_id}
                    type="button"
                    onClick={(ev) => {
                      ev.stopPropagation();
                      props.onSelectEvent(event);
                    }}
                    title={`${event.title} [${event.highest_credibility_tier} / ${event.conflict_status}]`}
                    style={{
                      position: "absolute",
                      left: `${Math.max(1, Math.min(92, ratio * 100)).toFixed(2)}%`,
                      top: 3,
                      bottom: 3,
                      borderRadius: 4,
                      border: "1px solid rgba(255,255,255,0.45)",
                      background: badgeBg,
                      color: "#0f172a",
                      fontWeight: 700,
                      fontSize: 10,
                      padding: "0 6px",
                      cursor: "pointer",
                      whiteSpace: "nowrap",
                    }}
                  >
                    ● {event.title.slice(0, 14)}
                  </button>
                );
              })}
              <div className="timeline-cursor-line" style={{ left: `${(cursorRatio * 100).toFixed(2)}%` }} />
            </div>
          </div>

          {/* Track 4: Director Keyframes (Expandable) */}
          {props.directorExpanded && (
            <div className="track-row">
              <div className="track-label">4. 导播关键帧</div>
              <div className="track-lane">
                {props.keyframes.map((kf, idx) => {
                  const ratio = jdnToScreenRatio(kf.historical_jdn, props.viewport);
                  const fallbackPos = props.keyframes.length > 1
                    ? (idx / (props.keyframes.length - 1)) * 88 + 4
                    : 10;
                  const leftPct = ratio >= 0 && ratio <= 1 ? ratio * 100 : fallbackPos;
                  return (
                    <button
                      key={kf.keyframe_id}
                      type="button"
                      onClick={() => props.onSelectKeyframe(kf)}
                      style={{
                        position: "absolute",
                        left: `${Math.max(1, Math.min(92, leftPct)).toFixed(2)}%`,
                        top: 3,
                        bottom: 3,
                        borderRadius: 4,
                        border: "1px solid #38bdf8",
                        background: "rgba(14, 116, 144, 0.85)",
                        color: "#f8fafc",
                        fontSize: 10,
                        padding: "0 6px",
                        cursor: "pointer",
                        whiteSpace: "nowrap",
                      }}
                      title={`t=${kf.video_time_sec}s · ${kf.easing}`}
                    >
                      ◆ {kf.video_time_sec}s
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
