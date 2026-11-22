import type { HistoricalTimestamp, TimeGranularity } from "./canonical.ts";

export type HistoricalEra = "BCE" | "CE";

export interface HistoricalDateParts {
  astronomical_year: number;
  month?: number;
  day?: number;
  hour?: number;
  minute?: number;
  uncertainty_days?: number;
  calendar_era_note?: string;
}

function assertInteger(value: number, min: number, max: number, field: string): void {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new RangeError(`${field} must be an integer between ${min} and ${max}`);
  }
}

// This range preserves sub-minute precision in a double-precision Julian day.
const MAX_YEAR = 1_000_000;

export function toAstronomicalYear(historicalYear: number, era: HistoricalEra): number {
  assertInteger(historicalYear, 1, era === "BCE" ? MAX_YEAR + 1 : MAX_YEAR, "historical year");
  return era === "BCE" ? 1 - historicalYear : historicalYear;
}

export function formatHistoricalYear(astronomicalYear: number): string {
  assertInteger(astronomicalYear, -MAX_YEAR, MAX_YEAR, "astronomical_year");
  return astronomicalYear <= 0 ? `公元前${1 - astronomicalYear}年` : `公元${astronomicalYear}年`;
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) {
    return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28;
  }
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

function julianDayAtMidnight(year: number, month: number, day: number): number {
  // Convert a proleptic Gregorian date to an astronomical Julian day.
  const januaryAdjustment = Math.floor((14 - month) / 12);
  const shiftedYear = year + 4800 - januaryAdjustment;
  const shiftedMonth = month + 12 * januaryAdjustment - 3;
  return day + Math.floor((153 * shiftedMonth + 2) / 5) + 365 * shiftedYear
    + Math.floor(shiftedYear / 4) - Math.floor(shiftedYear / 100)
    + Math.floor(shiftedYear / 400) - 32045.5;
}

export function createHistoricalTimestamp(parts: HistoricalDateParts): HistoricalTimestamp {
  const { astronomical_year: year, month, day, hour, minute, uncertainty_days: uncertainty } = parts;
  const label = formatHistoricalYear(year);
  if ((day !== undefined && month === undefined)
      || (hour !== undefined && day === undefined)
      || (minute !== undefined && hour === undefined)) {
    throw new RangeError("Date parts must be consecutive from year to the specified precision");
  }
  assertInteger(month ?? 1, 1, 12, "month");
  assertInteger(day ?? 1, 1, daysInMonth(year, month ?? 1), "day");
  assertInteger(hour ?? 0, 0, 23, "hour");
  assertInteger(minute ?? 0, 0, 59, "minute");
  if (uncertainty !== undefined && (!Number.isFinite(uncertainty) || uncertainty < 0)) {
    throw new RangeError("uncertainty_days must be finite and nonnegative");
  }

  return {
    ...parts,
    julian_day_number: julianDayAtMidnight(year, month ?? 1, day ?? 1)
      + ((hour ?? 0) * 60 + (minute ?? 0)) / 1440,
    historical_year_display: label,
  };
}

export function historicalPrecision(time: HistoricalTimestamp): TimeGranularity | "MINUTE" {
  if (time.minute !== undefined) return "MINUTE";
  if (time.hour !== undefined) return "HOUR";
  if (time.day !== undefined) return "DAY";
  return time.month === undefined ? "YEAR" : "MONTH";
}

export function historicalTimeWindow(time: HistoricalTimestamp): { start: number; end: number } {
  const year = time.astronomical_year;
  const month = time.month ?? 1;
  const start = time.julian_day_number;
  let end: number;
  switch (historicalPrecision(time)) {
    case "MINUTE": end = start + 1 / 1440; break;
    case "HOUR": end = start + 1 / 24; break;
    case "DAY": end = start + 1; break;
    case "MONTH": end = month === 12
      ? julianDayAtMidnight(year + 1, 1, 1)
      : julianDayAtMidnight(year, month + 1, 1); break;
    default: end = julianDayAtMidnight(year + 1, 1, 1);
  }
  const uncertainty = time.uncertainty_days ?? 0;
  return { start: start - uncertainty, end: end + uncertainty };
}
