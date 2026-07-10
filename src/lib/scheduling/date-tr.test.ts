import { describe, expect, it } from "vitest";

import {
  addDays,
  dateAtUtcMidnight,
  daysInMonth,
  diffInDays,
  getTurkishDayName,
  getTurkishMonthName,
  isSaturday,
  isSunday,
  isWeekend,
  parseDateKey,
  toDateKey,
} from "./date-tr";

describe("daysInMonth — leap year boundaries", () => {
  it("February in a common (non-leap) year has 28 days", () => {
    expect(daysInMonth(2025, 2)).toBe(28);
  });

  it("February in an ordinary leap year (divisible by 4) has 29 days", () => {
    expect(daysInMonth(2024, 2)).toBe(29);
  });

  it("February in a century year NOT divisible by 400 (1900) has 28 days, not 29", () => {
    // The Gregorian exception: divisible by 100 but not by 400.
    expect(daysInMonth(1900, 2)).toBe(28);
  });

  it("February in a century year divisible by 400 (2000) has 29 days", () => {
    expect(daysInMonth(2000, 2)).toBe(29);
  });

  it("January has 31 days", () => {
    expect(daysInMonth(2026, 1)).toBe(31);
  });

  it("December has 31 days", () => {
    expect(daysInMonth(2026, 12)).toBe(31);
  });

  it("April (a 30-day month) has 30 days", () => {
    expect(daysInMonth(2026, 4)).toBe(30);
  });
});

describe("dateAtUtcMidnight — local-date contract, no UTC day shifting", () => {
  it("produces exactly the requested UTC calendar date at midnight, with no hour/timezone drift", () => {
    const date = dateAtUtcMidnight(2026, 3, 15);
    expect(date.getUTCFullYear()).toBe(2026);
    expect(date.getUTCMonth()).toBe(2); // 0-indexed: March = 2
    expect(date.getUTCDate()).toBe(15);
    expect(date.getUTCHours()).toBe(0);
    expect(date.getUTCMinutes()).toBe(0);
    expect(date.getUTCSeconds()).toBe(0);
    expect(date.getUTCMilliseconds()).toBe(0);
  });

  it("the last day of February in a leap year round-trips correctly (day 29 is valid, not silently rolled to March 1)", () => {
    const date = dateAtUtcMidnight(2024, 2, 29);
    expect(date.getUTCMonth()).toBe(1); // still February
    expect(date.getUTCDate()).toBe(29);
  });
});

describe("toDateKey / parseDateKey — round trip, no shifting", () => {
  it("toDateKey produces YYYY-MM-DD for a UTC-midnight date", () => {
    expect(toDateKey(dateAtUtcMidnight(2026, 3, 5))).toBe("2026-03-05");
  });

  it("parseDateKey and dateAtUtcMidnight are inverses for a normal date", () => {
    const original = dateAtUtcMidnight(2026, 7, 4);
    const roundTripped = parseDateKey(toDateKey(original));
    expect(roundTripped?.getTime()).toBe(original.getTime());
  });

  it("parseDateKey round-trips the leap-day boundary (Feb 29) correctly", () => {
    const original = dateAtUtcMidnight(2024, 2, 29);
    const roundTripped = parseDateKey("2024-02-29");
    expect(roundTripped?.getTime()).toBe(original.getTime());
  });

  it("parseDateKey returns null for a malformed key instead of throwing or guessing", () => {
    expect(parseDateKey("not-a-date")).toBeNull();
    expect(parseDateKey("2026/03/05")).toBeNull();
    expect(parseDateKey("")).toBeNull();
  });
});

describe("diffInDays", () => {
  it("returns 0 for the same date", () => {
    const d = dateAtUtcMidnight(2026, 3, 10);
    expect(diffInDays(d, d)).toBe(0);
  });

  it("returns a positive count when the first date is later", () => {
    expect(diffInDays(dateAtUtcMidnight(2026, 3, 10), dateAtUtcMidnight(2026, 3, 5))).toBe(5);
  });

  it("returns a negative count when the first date is earlier", () => {
    expect(diffInDays(dateAtUtcMidnight(2026, 3, 5), dateAtUtcMidnight(2026, 3, 10))).toBe(-5);
  });

  it("correctly spans a leap-day February when counting across it", () => {
    // 2024-02-28 -> 2024-03-01 is 2 days apart (includes the leap day).
    expect(diffInDays(dateAtUtcMidnight(2024, 3, 1), dateAtUtcMidnight(2024, 2, 28))).toBe(2);
  });
});

describe("addDays", () => {
  it("adding days across a leap-year February boundary lands on the correct date", () => {
    const result = addDays(dateAtUtcMidnight(2024, 2, 28), 2);
    expect(toDateKey(result)).toBe("2024-03-01");
  });

  it("adding days across a non-leap-year February boundary lands one day earlier than in a leap year", () => {
    const result = addDays(dateAtUtcMidnight(2025, 2, 28), 1);
    expect(toDateKey(result)).toBe("2025-03-01");
  });
});

describe("isSaturday / isSunday / isWeekend", () => {
  it("correctly classifies a known Saturday and Sunday", () => {
    // 2026-03-07 is a Saturday, 2026-03-08 is a Sunday (UTC).
    const saturday = dateAtUtcMidnight(2026, 3, 7);
    const sunday = dateAtUtcMidnight(2026, 3, 8);
    expect(isSaturday(saturday)).toBe(true);
    expect(isSunday(saturday)).toBe(false);
    expect(isWeekend(saturday)).toBe(true);

    expect(isSunday(sunday)).toBe(true);
    expect(isSaturday(sunday)).toBe(false);
    expect(isWeekend(sunday)).toBe(true);
  });

  it("a weekday is neither Saturday, Sunday, nor a weekend", () => {
    const monday = dateAtUtcMidnight(2026, 3, 9);
    expect(isSaturday(monday)).toBe(false);
    expect(isSunday(monday)).toBe(false);
    expect(isWeekend(monday)).toBe(false);
  });
});

describe("Turkish name lookups", () => {
  it("getTurkishMonthName maps 1-12 to the correct Turkish month name", () => {
    expect(getTurkishMonthName(1)).toBe("Ocak");
    expect(getTurkishMonthName(2)).toBe("Şubat");
    expect(getTurkishMonthName(12)).toBe("Aralık");
  });

  it("getTurkishMonthName returns an empty string for an out-of-range month rather than throwing", () => {
    expect(getTurkishMonthName(0)).toBe("");
    expect(getTurkishMonthName(13)).toBe("");
  });

  it("getTurkishDayName maps a known date to the correct Turkish day name", () => {
    // 2026-03-08 is a Sunday.
    expect(getTurkishDayName(dateAtUtcMidnight(2026, 3, 8))).toBe("Pazar");
    // 2026-03-09 is a Monday.
    expect(getTurkishDayName(dateAtUtcMidnight(2026, 3, 9))).toBe("Pazartesi");
  });
});
