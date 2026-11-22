import {
  createHistoricalTimestamp,
  formatHistoricalYear,
  historicalPrecision,
  historicalTimeWindow,
} from "@historical-cartography/shared-schema";
import type {
  DirectorKeyframe,
  HistoricalEvent,
  HistoricalTimestamp,
  TimeGranularity,
} from "@historical-cartography/shared-schema";
import type { DynastyEraBand, HistoricalFigure } from "../data/demo-types.ts";

export interface TimelineViewport {
  min_jdn: number;
  max_jdn: number;
  cursor_jdn: number;
  granularity: TimeGranularity;
}

export interface TimelineTick {
  jdn: number;
  ratio: number;
  label: string;
  is_major: boolean;
}

export interface BottomTimelineConfig {
  viewport: TimelineViewport;
  dynasty_bands: DynastyEraBand[];
  figures: HistoricalFigure[];
  events: HistoricalEvent[];
  keyframes: DirectorKeyframe[];
  director_track_expanded: boolean;
}

const DAY_PER_YEAR = 365.2425;

/**
 * Inverse proleptic Gregorian JDN -> astronomical date fields without using JS `Date`.
 * Matches `julianDayAtMidnight` in `packages/shared-schema/src/historical-time.ts`.
 */
export function jdnToHistoricalParts(jdn: number): {
  astronomical_year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  historical_year_display: string;
} {
  const shifted = jdn + 0.5;
  const z = Math.floor(shifted);
  const f = shifted - z;

  let a = z;
  const alpha = Math.floor((z - 1867216.25) / 36524.25);
  a = z + 1 + alpha - Math.floor(alpha / 4);

  const b = a + 1524;
  const c = Math.floor((b - 122.1) / 365.25);
  const d = Math.floor(365.25 * c);
  const e = Math.floor((b - d) / 30.6001);

  const day = b - d - Math.floor(30.6001 * e);
  const month = e < 14 ? e - 1 : e - 13;
  const astronomical_year = month > 2 ? c - 4716 : c - 4715;

  const totalMinutes = Math.round(f * 1440) % 1440;
  const hour = Math.floor(totalMinutes / 60);
  const minute = totalMinutes % 60;

  return {
    astronomical_year,
    month,
    day,
    hour,
    minute,
    historical_year_display: formatHistoricalYear(astronomical_year),
  };
}

export function formatJdnLabel(jdn: number, granularity: TimeGranularity): string {
  const p = jdnToHistoricalParts(jdn);
  const pad = (n: number): string => String(n).padStart(2, "0");
  switch (granularity) {
    case "CENTURY":
    case "DECADE":
    case "YEAR":
      return p.historical_year_display;
    case "MONTH":
      return `${p.historical_year_display}${p.month}月`;
    case "DAY":
      return `${p.historical_year_display}${p.month}月${p.day}日`;
    case "HOUR":
      return `${p.historical_year_display}${p.month}月${p.day}日 ${pad(p.hour)}:${pad(p.minute)}`;
  }
}

export function formatTimestampWithPrecision(ts: HistoricalTimestamp): string {
  const prec = historicalPrecision(ts);
  const base = ts.historical_year_display;
  const pad = (n: number): string => String(n).padStart(2, "0");
  let detail = base;
  if (prec === "MONTH" && ts.month !== undefined) {
    detail = `${base}${ts.month}月`;
  } else if (prec === "DAY" && ts.month !== undefined && ts.day !== undefined) {
    detail = `${base}${ts.month}月${ts.day}日`;
  } else if (
    (prec === "HOUR" || prec === "MINUTE")
    && ts.month !== undefined
    && ts.day !== undefined
    && ts.hour !== undefined
  ) {
    detail = `${base}${ts.month}月${ts.day}日 ${pad(ts.hour)}:${pad(ts.minute ?? 0)}`;
  }
  const win = historicalTimeWindow(ts);
  const spanDays = Math.round(win.end - win.start);
  const uncNote = ts.uncertainty_days !== undefined && ts.uncertainty_days > 0
    ? ` (±${ts.uncertainty_days}天)`
    : "";
  const era = ts.calendar_era_note ? ` · ${ts.calendar_era_note}` : "";
  return `${detail}${uncNote} [${prec}, 窗口约${spanDays}天]${era}`;
}

export function classifySpanGranularity(spanDays: number): TimeGranularity {
  if (spanDays >= DAY_PER_YEAR * 400) return "CENTURY";
  if (spanDays >= DAY_PER_YEAR * 45) return "DECADE";
  if (spanDays >= DAY_PER_YEAR * 3) return "YEAR";
  if (spanDays >= 45) return "MONTH";
  if (spanDays >= 3) return "DAY";
  return "HOUR";
}

export function zoomTimelineViewport(
  viewport: TimelineViewport,
  anchorRatio: number,
  zoomFactor: number,
  minSpanDays = 0.25, // 6 hours minimum tactical campaign scale
  maxSpanDays = DAY_PER_YEAR * 2500,
): TimelineViewport {
  const clampedRatio = Math.max(0, Math.min(1, anchorRatio));
  const currentSpan = Math.max(minSpanDays, viewport.max_jdn - viewport.min_jdn);
  const nextSpan = Math.max(minSpanDays, Math.min(maxSpanDays, currentSpan * zoomFactor));
  const anchorJdn = viewport.min_jdn + currentSpan * clampedRatio;
  const nextMin = anchorJdn - nextSpan * clampedRatio;
  const nextMax = nextMin + nextSpan;
  const nextCursor = Math.max(nextMin, Math.min(nextMax, viewport.cursor_jdn));

  return {
    min_jdn: nextMin,
    max_jdn: nextMax,
    cursor_jdn: nextCursor,
    granularity: classifySpanGranularity(nextSpan),
  };
}

export function generateTimelineTicks(
  viewport: TimelineViewport,
  targetCount = 7,
): TimelineTick[] {
  const span = Math.max(1e-6, viewport.max_jdn - viewport.min_jdn);
  const rawStep = span / Math.max(2, targetCount);

  let stepDays: number;
  if (span >= DAY_PER_YEAR * 400) stepDays = DAY_PER_YEAR * 100;
  else if (span >= DAY_PER_YEAR * 80) stepDays = DAY_PER_YEAR * 20;
  else if (span >= DAY_PER_YEAR * 8) stepDays = DAY_PER_YEAR;
  else if (span >= 90) stepDays = 30;
  else if (span >= 6) stepDays = 1;
  else stepDays = Math.max(1 / 24, rawStep);

  const startIndex = Math.ceil(viewport.min_jdn / stepDays);
  const endIndex = Math.floor(viewport.max_jdn / stepDays);
  const ticks: TimelineTick[] = [];

  for (let i = startIndex; i <= endIndex && ticks.length < 32; i++) {
    const jdn = i * stepDays;
    const ratio = (jdn - viewport.min_jdn) / span;
    if (ratio < -0.001 || ratio > 1.001) continue;
    ticks.push({
      jdn,
      ratio: Math.max(0, Math.min(1, ratio)),
      label: formatJdnLabel(jdn, viewport.granularity),
      is_major: i % 2 === 0,
    });
  }

  if (ticks.length === 0) {
    ticks.push(
      { jdn: viewport.min_jdn, ratio: 0, label: formatJdnLabel(viewport.min_jdn, viewport.granularity), is_major: true },
      { jdn: viewport.max_jdn, ratio: 1, label: formatJdnLabel(viewport.max_jdn, viewport.granularity), is_major: true },
    );
  }
  return ticks;
}

export function buildPresetTimelineSpan(granularity: TimeGranularity, cursorJdn: number): TimelineViewport {
  let halfSpanDays: number;
  switch (granularity) {
    case "CENTURY":
      halfSpanDays = DAY_PER_YEAR * 600;
      break;
    case "DECADE":
      halfSpanDays = DAY_PER_YEAR * 60;
      break;
    case "YEAR":
      halfSpanDays = DAY_PER_YEAR * 5;
      break;
    case "MONTH":
      halfSpanDays = 180;
      break;
    case "DAY":
      halfSpanDays = 12;
      break;
    case "HOUR":
      halfSpanDays = 0.75; // 36-hour tactical battle window
      break;
  }
  return {
    min_jdn: cursorJdn - halfSpanDays,
    max_jdn: cursorJdn + halfSpanDays,
    cursor_jdn: cursorJdn,
    granularity,
  };
}

export function jdnToScreenRatio(jdn: number, viewport: TimelineViewport): number {
  const span = Math.max(1e-6, viewport.max_jdn - viewport.min_jdn);
  return (jdn - viewport.min_jdn) / span;
}

export function screenRatioToJdn(ratio: number, viewport: TimelineViewport): number {
  const clamped = Math.max(0, Math.min(1, ratio));
  return viewport.min_jdn + clamped * (viewport.max_jdn - viewport.min_jdn);
}

export const DEFAULT_DYNASTY_BANDS: DynastyEraBand[] = [
  {
    band_id: "band-han-xiyu",
    label_zh: "西汉 · 西域都护府",
    era_note: "前 1 年 — 公元 1 年（跨零点连续）",
    polity_id: "polity-han",
    valid_from_jdn: createHistoricalTimestamp({ astronomical_year: -1 }).julian_day_number,
    valid_to_jdn: createHistoricalTimestamp({ astronomical_year: 4 }).julian_day_number,
    color_hex: "#c95b38",
  },
  {
    band_id: "band-samanid-842",
    label_zh: "萨曼家族河中统合",
    era_note: "公元 842 年 / 会昌二年",
    polity_id: "polity-samanid",
    valid_from_jdn: createHistoricalTimestamp({ astronomical_year: 819 }).julian_day_number,
    valid_to_jdn: createHistoricalTimestamp({ astronomical_year: 874 }).julian_day_number,
    color_hex: "#3ca653",
  },
  {
    band_id: "band-samanid-928",
    label_zh: "萨曼—齐亚尔全盛与雷伊之役",
    era_note: "公元 928 年 / 天成三年 / 回历 316 年",
    polity_id: "polity-samanid",
    valid_from_jdn: createHistoricalTimestamp({ astronomical_year: 875 }).julian_day_number,
    valid_to_jdn: createHistoricalTimestamp({ astronomical_year: 999 }).julian_day_number,
    color_hex: "#2f855a",
  },
];

export function configureBottomTimeline(config: BottomTimelineConfig): BottomTimelineConfig {
  return {
    ...config,
    dynasty_bands: [...config.dynasty_bands],
    figures: [...config.figures],
    events: [...config.events],
    keyframes: [...config.keyframes].sort((a, b) => a.video_time_sec - b.video_time_sec),
  };
}
