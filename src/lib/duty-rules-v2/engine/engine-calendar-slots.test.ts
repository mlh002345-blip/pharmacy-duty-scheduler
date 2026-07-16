import { describe, expect, it } from "vitest";

import { resolveCalendarContext } from "./resolve-calendar-context";
import { dayTypeKeyOf, resolveDayType } from "./resolve-day-type";
import { resolveShifts } from "./resolve-shifts";
import { resolveSlots } from "./resolve-slots";
import { makeLoadedPlan } from "./test-support/fixtures";
import type { EngineHoliday } from "./domain/engine-input";

function contextsFor(dates: { start: string; end: string }, holidays: EngineHoliday[] = [], overrides: { date: string; customDayCategory: string }[] = []) {
  return resolveCalendarContext({
    periodStart: dates.start,
    periodEnd: dates.end,
    holidays,
    customDayOverrides: overrides,
  });
}

describe("resolveCalendarContext", () => {
  it("classifies weekday, Saturday, and Sunday from pure calendar facts", () => {
    const [monday, saturday, sunday] = [
      contextsFor({ start: "2026-08-03", end: "2026-08-03" })[0],
      contextsFor({ start: "2026-08-08", end: "2026-08-08" })[0],
      contextsFor({ start: "2026-08-09", end: "2026-08-09" })[0],
    ];
    expect(monday).toMatchObject({ weekdayNumber: 1, weekdayName: "MONDAY", isSaturday: false, isSunday: false });
    expect(monday.candidateDayTypes).toEqual(["WEEKDAY"]);
    expect(saturday).toMatchObject({ weekdayNumber: 6, isSaturday: true });
    expect(saturday.candidateDayTypes).toEqual(["SATURDAY", "WEEKDAY"]);
    expect(sunday).toMatchObject({ weekdayNumber: 7, isSunday: true });
    expect(sunday.candidateDayTypes).toEqual(["SUNDAY", "WEEKDAY"]);
  });

  it("classifies official and religious holidays, and OTHER as official (V1 rule)", () => {
    const holidays: EngineHoliday[] = [
      { date: "2026-08-04", name: "Resmî Gün", type: "OFFICIAL" },
      { date: "2026-08-05", name: "Dinî Gün", type: "RELIGIOUS" },
      { date: "2026-08-06", name: "Yerel Gün", type: "OTHER" },
    ];
    const contexts = contextsFor({ start: "2026-08-04", end: "2026-08-06" }, holidays);
    expect(contexts[0].candidateDayTypes[0]).toBe("OFFICIAL_HOLIDAY");
    expect(contexts[1].candidateDayTypes[0]).toBe("RELIGIOUS_HOLIDAY");
    expect(contexts[2].candidateDayTypes[0]).toBe("OFFICIAL_HOLIDAY"); // OTHER → official
  });

  it("marks holiday eves (also from a holiday just outside the period) and keeps overlapping holiday metadata", () => {
    const holidays: EngineHoliday[] = [
      { date: "2026-09-01", name: "A Bayramı", type: "RELIGIOUS" },
      { date: "2026-09-01", name: "B Günü", type: "OFFICIAL" },
    ];
    const [eve] = contextsFor({ start: "2026-08-31", end: "2026-08-31" }, holidays);
    expect(eve.isHolidayEve).toBe(true);
    expect(eve.candidateDayTypes[0]).toBe("HOLIDAY_EVE");
    const [holiday] = contextsFor({ start: "2026-09-01", end: "2026-09-01" }, holidays);
    // Overlap preserved and deterministically ordered (type, then name).
    expect(holiday.holidays.map((h) => h.name)).toEqual(["B Günü", "A Bayramı"]);
    expect(holiday.candidateDayTypes.slice(0, 2)).toEqual(["RELIGIOUS_HOLIDAY", "OFFICIAL_HOLIDAY"]);
  });

  it("handles leap day and month/year boundaries without shifting a day", () => {
    const leap = contextsFor({ start: "2028-02-28", end: "2028-03-01" });
    expect(leap.map((c) => c.date)).toEqual(["2028-02-28", "2028-02-29", "2028-03-01"]);
    const year = contextsFor({ start: "2026-12-31", end: "2027-01-01" });
    expect(year.map((c) => c.date)).toEqual(["2026-12-31", "2027-01-01"]);
    // 2028-02-29 is a Tuesday in UTC calendar terms.
    expect(leap[1].weekdayName).toBe("TUESDAY");
  });

  it("DST-adjacent dates (late March / late October) never shift", () => {
    const spring = contextsFor({ start: "2026-03-28", end: "2026-03-30" });
    expect(spring.map((c) => c.date)).toEqual(["2026-03-28", "2026-03-29", "2026-03-30"]);
    expect(spring.map((c) => c.weekdayName)).toEqual(["SATURDAY", "SUNDAY", "MONDAY"]);
    const autumn = contextsFor({ start: "2026-10-24", end: "2026-10-26" });
    expect(autumn.map((c) => c.weekdayName)).toEqual(["SATURDAY", "SUNDAY", "MONDAY"]);
  });
});

describe("resolveDayType", () => {
  const plan = makeLoadedPlan();

  it("resolves by documented precedence including custom override first", () => {
    const withCustom = makeLoadedPlan((p) => {
      p.dayTypeRules.push({
        id: "dtr-custom",
        dayType: "WEEKDAY",
        isServed: true,
        customDayCategory: "Pazar Yeri Günü",
      });
    });
    const [context] = contextsFor(
      { start: "2026-08-08", end: "2026-08-08" }, // a Saturday
      [{ date: "2026-08-08", name: "Resmî", type: "OFFICIAL" }],
      [{ date: "2026-08-08", customDayCategory: "Pazar Yeri Günü" }]
    );
    const resolved = resolveDayType(context, withCustom.dayTypeRules);
    // Override beats the official holiday AND the Saturday.
    expect(resolved).toMatchObject({
      resolved: true,
      dayType: "WEEKDAY",
      customDayCategory: "Pazar Yeri Günü",
      dayTypeKey: dayTypeKeyOf("WEEKDAY", "Pazar Yeri Günü"),
    });
    expect(resolved.precedence[0]).toContain("CUSTOM_OVERRIDE");
  });

  it("religious beats official beats eve beats Sunday (overlap tested explicitly)", () => {
    const [context] = contextsFor(
      { start: "2026-08-09", end: "2026-08-09" }, // Sunday
      [
        { date: "2026-08-09", name: "Dinî", type: "RELIGIOUS" },
        { date: "2026-08-09", name: "Resmî", type: "OFFICIAL" },
        { date: "2026-08-10", name: "Ertesi", type: "OFFICIAL" }, // makes it an eve too
      ]
    );
    expect(context.candidateDayTypes).toEqual([
      "RELIGIOUS_HOLIDAY",
      "OFFICIAL_HOLIDAY",
      "HOLIDAY_EVE",
      "SUNDAY",
      "WEEKDAY",
    ]);
    const resolved = resolveDayType(context, plan.dayTypeRules);
    expect(resolved.dayType).toBe("RELIGIOUS_HOLIDAY");
  });

  it("returns a controlled unresolved result for unknown and ambiguous custom categories", () => {
    const [context] = contextsFor(
      { start: "2026-08-03", end: "2026-08-03" },
      [],
      [{ date: "2026-08-03", customDayCategory: "Tanımsız Kategori" }]
    );
    const unknown = resolveDayType(context, plan.dayTypeRules);
    expect(unknown.resolved).toBe(false);
    expect(unknown.diagnostics[0].code).toBe("UNKNOWN_CUSTOM_DAY_CATEGORY");

    const ambiguousPlan = makeLoadedPlan((p) => {
      p.dayTypeRules.push(
        { id: "dtr-c1", dayType: "WEEKDAY", isServed: true, customDayCategory: "Çifte" },
        { id: "dtr-c2", dayType: "SUNDAY", isServed: true, customDayCategory: "Çifte" }
      );
    });
    const [context2] = contextsFor(
      { start: "2026-08-03", end: "2026-08-03" },
      [],
      [{ date: "2026-08-03", customDayCategory: "Çifte" }]
    );
    const ambiguous = resolveDayType(context2, ambiguousPlan.dayTypeRules);
    expect(ambiguous.resolved).toBe(false);
    expect(ambiguous.diagnostics[0].code).toBe("AMBIGUOUS_DAY_TYPE");
  });

  it("marks unserved day types as served: false with an UNSERVED_DAY diagnostic", () => {
    const unservedPlan = makeLoadedPlan((p) => {
      const sunday = p.dayTypeRules.find((r) => r.dayType === "SUNDAY");
      if (sunday) sunday.isServed = false;
    });
    const [context] = contextsFor({ start: "2026-08-09", end: "2026-08-09" });
    const resolved = resolveDayType(context, unservedPlan.dayTypeRules);
    expect(resolved).toMatchObject({ resolved: true, dayType: "SUNDAY", served: false });
    expect(resolved.diagnostics[0].code).toBe("UNSERVED_DAY");
  });
});

describe("resolveShifts / resolveSlots", () => {
  it("returns the null-time synthetic V1 shift without fabricated hours", () => {
    const plan = makeLoadedPlan();
    const [context] = contextsFor({ start: "2026-08-03", end: "2026-08-03" });
    const dayType = resolveDayType(context, plan.dayTypeRules);
    const { shifts } = resolveShifts(dayType, plan);
    expect(shifts).toHaveLength(1);
    expect(shifts[0]).toMatchObject({ startMinute: null, endMinute: null, spansMidnight: null });
  });

  it("supports multiple shifts (incl. overnight) with deterministic ordering, and multiple slots with requiredCount > 1", () => {
    const plan = makeLoadedPlan((p) => {
      p.shiftDefinitions = [
        { id: "sh-night", name: "Gece", startMinute: 1140, endMinute: 480, spansMidnight: true, defaultWeight: 1.5, sortOrder: 1 },
        { id: "sh-day", name: "Gündüz", startMinute: 480, endMinute: 1140, spansMidnight: false, defaultWeight: 1, sortOrder: 0 },
      ];
      p.slotRequirements = [
        { id: "s-1", name: null, requiredCount: 2, sortOrder: 0, dayTypeRuleId: "dtr-WEEKDAY", shiftDefinitionId: "sh-day", rotationPoolId: "pool-1" },
        { id: "s-2", name: "Ek", requiredCount: 1, sortOrder: 1, dayTypeRuleId: "dtr-WEEKDAY", shiftDefinitionId: "sh-day", rotationPoolId: "pool-1" },
        { id: "s-3", name: null, requiredCount: 1, sortOrder: 2, dayTypeRuleId: "dtr-WEEKDAY", shiftDefinitionId: "sh-night", rotationPoolId: "pool-1" },
      ];
    });
    const [context] = contextsFor({ start: "2026-08-03", end: "2026-08-03" });
    const dayType = resolveDayType(context, plan.dayTypeRules);
    const { shifts } = resolveShifts(dayType, plan);
    expect(shifts.map((s) => s.shiftKey)).toEqual(["Gündüz", "Gece"]); // sortOrder
    expect(shifts[1]).toMatchObject({ spansMidnight: true, startMinute: 1140 });

    const { slots } = resolveSlots(dayType, shifts, plan);
    expect(slots).toHaveLength(3); // never collapsed
    expect(slots.map((s) => s.slotKey)).toEqual([
      "2026-08-03:WEEKDAY:Gündüz:0",
      "2026-08-03:WEEKDAY:Gündüz:1",
      "2026-08-03:WEEKDAY:Gece:2",
    ]);
    expect(slots[0].requiredCount).toBe(2);
  });

  it("served and unserved day types: unserved dates expand zero slots", () => {
    const plan = makeLoadedPlan((p) => {
      const weekday = p.dayTypeRules.find((r) => r.dayType === "WEEKDAY");
      if (weekday) weekday.isServed = false;
    });
    const [context] = contextsFor({ start: "2026-08-03", end: "2026-08-03" });
    const dayType = resolveDayType(context, plan.dayTypeRules);
    const { shifts } = resolveShifts(dayType, plan);
    const { slots } = resolveSlots(dayType, shifts, plan);
    expect(slots).toEqual([]);
  });

  it("a null pool reference stays explicit and unresolved — no invented default pool", () => {
    const plan = makeLoadedPlan((p) => {
      p.slotRequirements = p.slotRequirements.map((slot) =>
        slot.dayTypeRuleId === "dtr-WEEKDAY" ? { ...slot, rotationPoolId: null } : slot
      );
    });
    const [context] = contextsFor({ start: "2026-08-03", end: "2026-08-03" });
    const dayType = resolveDayType(context, plan.dayTypeRules);
    const { shifts } = resolveShifts(dayType, plan);
    const { slots, diagnostics } = resolveSlots(dayType, shifts, plan);
    expect(slots[0].poolId).toBeNull();
    expect(slots[0].resolvable).toBe(false);
    expect(diagnostics.some((d) => d.code === "SLOT_WITHOUT_POOL")).toBe(true);
  });
});
