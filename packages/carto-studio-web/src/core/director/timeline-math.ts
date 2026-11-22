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
 * Carries rounding overflows cleanly at 23:59:30+ into the following calendar day.
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
  let z = Math.floor(shifted);
  const f = shifted - z;

  const rawMinutes = Math.round(f * 1440);
  const carryDays = Math.floor(rawMinutes / 1440);
  z += carryDays;
  const totalMinutes = rawMinutes - carryDays * 1440;
  const hour = Math.floor(totalMinutes / 60);
  const minute = totalMinutes % 60;

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
  minSpanDays = 0.25,
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

export function panTimelineViewport(
  viewport: TimelineViewport,
  deltaRatio: number,
): TimelineViewport {
  const span = Math.max(0.25, viewport.max_jdn - viewport.min_jdn);
  const deltaJdn = deltaRatio * span;
  return {
    ...viewport,
    min_jdn: viewport.min_jdn + deltaJdn,
    max_jdn: viewport.max_jdn + deltaJdn,
    cursor_jdn: Math.max(viewport.min_jdn + deltaJdn, Math.min(viewport.max_jdn + deltaJdn, viewport.cursor_jdn)),
  };
}

/**
 * Generate calendar-exact ticks aligned to round centuries/decades/years/months/days/hours.
 */
export function generateTimelineTicks(
  viewport: TimelineViewport,
  targetCount = 7,
): TimelineTick[] {
  const span = Math.max(1e-6, viewport.max_jdn - viewport.min_jdn);
  const ticks: TimelineTick[] = [];

  if (span >= DAY_PER_YEAR * 3) {
    const startYear = jdnToHistoricalParts(viewport.min_jdn).astronomical_year;
    const endYear = jdnToHistoricalParts(viewport.max_jdn).astronomical_year;
    const yearSpan = Math.max(1, endYear - startYear);
    const candidates = [1, 2, 5, 10, 20, 50, 100, 200, 500];
    let stepYears = 100;
    for (const c of candidates) {
      if (yearSpan / c <= targetCount + 2) {
        stepYears = c;
        break;
      }
    }
    const firstYr = Math.ceil(startYear / stepYears) * stepYears;
    for (let yr = firstYr; yr <= endYear && ticks.length < 28; yr += stepYears) {
      const jdn = createHistoricalTimestamp({ astronomical_year: yr }).julian_day_number;
      const ratio = (jdn - viewport.min_jdn) / span;
      if (ratio < -0.001 || ratio > 1.001) continue;
      ticks.push({
        jdn,
        ratio: Math.max(0, Math.min(1, ratio)),
        label: formatHistoricalYear(yr),
        is_major: yr % (stepYears * 2) === 0,
      });
    }
  } else if (span >= 45) {
    const startParts = jdnToHistoricalParts(viewport.min_jdn);
    const endParts = jdnToHistoricalParts(viewport.max_jdn);
    let yr = startParts.astronomical_year;
    let m = startParts.month;
    const totalMonths = (endParts.astronomical_year - startParts.astronomical_year) * 12 + (endParts.month - startParts.month);
    const stepM = totalMonths > 18 ? 3 : 1;
    while ((yr < endParts.astronomical_year || (yr === endParts.astronomical_year && m <= endParts.month)) && ticks.length < 24) {
      const jdn = createHistoricalTimestamp({ astronomical_year: yr, month: m, day: 1 }).julian_day_number;
      const ratio = (jdn - viewport.min_jdn) / span;
      if (ratio >= -0.001 && ratio <= 1.001) {
        ticks.push({
          jdn,
          ratio: Math.max(0, Math.min(1, ratio)),
          label: `${formatHistoricalYear(yr)}${m}月`,
          is_major: m === 1,
        });
      }
      m += stepM;
      while (m > 12) {
        m -= 12;
        yr += 1;
      }
    }
  } else if (span >= 3) {
    const stepDays = span > 24 ? 3 : 1;
    const firstDay = Math.ceil(viewport.min_jdn - 0.5) + 0.5;
    for (let jdn = firstDay; jdn <= viewport.max_jdn && ticks.length < 28; jdn += stepDays) {
      const ratio = (jdn - viewport.min_jdn) / span;
      if (ratio < -0.001 || ratio > 1.001) continue;
      ticks.push({
        jdn,
        ratio: Math.max(0, Math.min(1, ratio)),
        label: formatJdnLabel(jdn, "DAY"),
        is_major: Math.round(jdn - 0.5) % 5 === 0,
      });
    }
  } else {
    const spanHours = span * 24;
    const stepH = spanHours > 48 ? 6 : spanHours > 18 ? 3 : 1;
    const stepDays = stepH / 24;
    const startIdx = Math.ceil((viewport.min_jdn + 0.5) / stepDays);
    const endIdx = Math.floor((viewport.max_jdn + 0.5) / stepDays);
    for (let idx = startIdx; idx <= endIdx && ticks.length < 24; idx++) {
      const jdn = idx * stepDays - 0.5;
      const ratio = (jdn - viewport.min_jdn) / span;
      if (ratio < -0.001 || ratio > 1.001) continue;
      ticks.push({
        jdn,
        ratio: Math.max(0, Math.min(1, ratio)),
        label: formatJdnLabel(jdn, "HOUR"),
        is_major: idx % 2 === 0,
      });
    }
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
    case "CENTURY": halfSpanDays = DAY_PER_YEAR * 600; break;
    case "DECADE": halfSpanDays = DAY_PER_YEAR * 60; break;
    case "YEAR": halfSpanDays = DAY_PER_YEAR * 5; break;
    case "MONTH": halfSpanDays = 180; break;
    case "DAY": halfSpanDays = 12; break;
    case "HOUR": halfSpanDays = 0.75; break;
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
    band_id: "band-ca-960-conversion",
    label_zh: "960年 · 突厥二十万帐改宗基线",
    era_note: "公元 960–961 年 / 回历 349–350 年 / 北宋建隆元–二年",
    polity_id: "polity-qarakhanid",
    valid_from_jdn: createHistoricalTimestamp({ astronomical_year: 960, month: 1, day: 1 }).julian_day_number,
    valid_to_jdn: createHistoricalTimestamp({ astronomical_year: 962, month: 5, day: 15 }).julian_day_number,
    focus_jdn: createHistoricalTimestamp({ astronomical_year: 960, month: 6, day: 1 }).julian_day_number,
    parallel_eras: [
      { polity_zh: "北宋", era_text: "太祖建隆元–二年" },
      { polity_zh: "回历", era_text: "349–350 AH" },
    ],
    color_hex: "#d946ef",
  },
  {
    band_id: "band-ca-962-ghazna",
    label_zh: "962年 · 阿尔普特勤取加兹尼",
    era_note: "公元 962–966 年 / 回历 351–355 年 / 北宋建隆三年–乾德四年",
    polity_id: "polity-ghaznavid",
    valid_from_jdn: createHistoricalTimestamp({ astronomical_year: 962, month: 5, day: 15 }).julian_day_number,
    valid_to_jdn: createHistoricalTimestamp({ astronomical_year: 967, month: 12, day: 1 }).julian_day_number,
    focus_jdn: createHistoricalTimestamp({ astronomical_year: 962, month: 5, day: 15 }).julian_day_number,
    parallel_eras: [
      { polity_zh: "北宋", era_text: "建隆三年–乾德四年" },
      { polity_zh: "回历", era_text: "351–355 AH" },
    ],
    color_hex: "#0d9488",
  },
  {
    band_id: "band-ca-968-kerman",
    label_zh: "967–968年 · 白益吞并克尔曼",
    era_note: "公元 967–969 年 / 回历 356–358 年 / 北宋开宝元–二年",
    polity_id: "polity-buyid",
    valid_from_jdn: createHistoricalTimestamp({ astronomical_year: 967, month: 12, day: 1 }).julian_day_number,
    valid_to_jdn: createHistoricalTimestamp({ astronomical_year: 970, month: 8, day: 15 }).julian_day_number,
    focus_jdn: createHistoricalTimestamp({ astronomical_year: 968, month: 6, day: 15 }).julian_day_number,
    parallel_eras: [
      { polity_zh: "北宋", era_text: "太祖开宝元–二年" },
      { polity_zh: "回历", era_text: "356–358 AH" },
    ],
    color_hex: "#2563eb",
  },
  {
    band_id: "band-ca-970-khotan",
    label_zh: "970年 · 于阗克喀什噶尔与锡斯坦内战",
    era_note: "公元 970–971 年 / 回历 359–360 年 / 北宋开宝三–四年",
    polity_id: "polity-khotan",
    valid_from_jdn: createHistoricalTimestamp({ astronomical_year: 970, month: 8, day: 15 }).julian_day_number,
    valid_to_jdn: createHistoricalTimestamp({ astronomical_year: 972, month: 4, day: 15 }).julian_day_number,
    focus_jdn: createHistoricalTimestamp({ astronomical_year: 970, month: 8, day: 15 }).julian_day_number,
    parallel_eras: [
      { polity_zh: "北宋", era_text: "开宝三–四年 (于阗献舞象)" },
      { polity_zh: "回历", era_text: "359–360 AH" },
    ],
    color_hex: "#eab308",
  },
  {
    band_id: "band-ca-975-treaty",
    label_zh: "972–975年 · 萨曼—白益纳贡和约与加德兹",
    era_note: "公元 972–975 年 / 回历 361–364 年 / 北宋开宝五–八年",
    polity_id: "polity-samanid",
    valid_from_jdn: createHistoricalTimestamp({ astronomical_year: 972, month: 4, day: 15 }).julian_day_number,
    valid_to_jdn: createHistoricalTimestamp({ astronomical_year: 976, month: 6, day: 15 }).julian_day_number,
    focus_jdn: createHistoricalTimestamp({ astronomical_year: 972, month: 4, day: 15 }).julian_day_number,
    parallel_eras: [
      { polity_zh: "北宋", era_text: "开宝五–八年" },
      { polity_zh: "回历", era_text: "361–364 AH" },
    ],
    color_hex: "#1f9d55",
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
