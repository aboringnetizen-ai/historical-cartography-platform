import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createHistoricalTimestamp,
  formatHistoricalYear,
  historicalPrecision,
  historicalTimeWindow,
  toAstronomicalYear,
} from "@historical-cartography/shared-schema";

test("historical dates cross directly from 1 BCE to 1 CE", () => {
  const finalBce = createHistoricalTimestamp({
    astronomical_year: toAstronomicalYear(1, "BCE"), month: 12, day: 31,
  });
  const firstCe = createHistoricalTimestamp({
    astronomical_year: toAstronomicalYear(1, "CE"), month: 1, day: 1,
  });
  assert.equal(finalBce.astronomical_year, 0);
  assert.equal(finalBce.historical_year_display, "公元前1年");
  assert.equal(firstCe.historical_year_display, "公元1年");
  assert.equal(firstCe.julian_day_number - finalBce.julian_day_number, 1);
  assert.equal(formatHistoricalYear(toAstronomicalYear(202, "BCE")), "公元前202年");
  assert.throws(() => toAstronomicalYear(0, "CE"), RangeError);
});

test("Julian day uses noon as its integer boundary and orders minutes", () => {
  const day = { astronomical_year: 2000, month: 1, day: 1 };
  assert.equal(createHistoricalTimestamp(day).julian_day_number, 2451544.5);
  assert.equal(createHistoricalTimestamp({ ...day, hour: 12 }).julian_day_number, 2451545);
  const event = { astronomical_year: 1672, month: 12, day: 9, hour: 20 };
  const atHour = createHistoricalTimestamp(event);
  const atMinute = createHistoricalTimestamp({ ...event, minute: 1 });
  assert.ok(atMinute.julian_day_number > atHour.julian_day_number);
  assert.equal(historicalPrecision(atHour), "HOUR");
  assert.equal(historicalPrecision(atMinute), "MINUTE");
});

test("year and month estimates retain their precision and uncertainty window", () => {
  const year = createHistoricalTimestamp({ astronomical_year: 0, uncertainty_days: 2 });
  assert.equal(year.month, undefined);
  assert.deepEqual(historicalTimeWindow(year), {
    start: year.julian_day_number - 2,
    end: createHistoricalTimestamp({ astronomical_year: 1 }).julian_day_number + 2,
  });
  const february = historicalTimeWindow(createHistoricalTimestamp({ astronomical_year: 0, month: 2 }));
  assert.equal(february.end - february.start, 29);
});

test("invalid calendar dates and incomplete date precision are rejected", () => {
  for (const parts of [
    { astronomical_year: 1900, month: 2, day: 29 },
    { astronomical_year: 928, month: 13 },
    { astronomical_year: 928, day: 5 },
    { astronomical_year: 928, month: 1, day: 1, minute: 5 },
    { astronomical_year: 928, month: 1, day: 1, hour: 24 },
    { astronomical_year: 928, uncertainty_days: -1 },
    { astronomical_year: 928.5 },
  ]) {
    assert.throws(() => createHistoricalTimestamp(parts), RangeError);
  }
});
