import { describe, expect, it } from "vitest";

import { generateDutySchedule } from "./generate-duty-schedule";
import { dateAtUtcMidnight, daysInMonth } from "./date-tr";

const BASE_DUTY_RULE = {
  minDaysBetweenDuties: 0,
  weekdayWeight: 1,
  saturdayWeight: 1.25,
  sundayWeight: 1.5,
  officialHolidayWeight: 2,
  religiousHolidayWeight: 2,
};

const REGION_ID = "region-1";
const MONTH = 3;
const YEAR = 2026;

function pharmacy(id: string, overrides: Partial<{ isActive: boolean; regionId: string }> = {}) {
  return {
    id,
    name: id,
    isActive: overrides.isActive ?? true,
    regionId: overrides.regionId ?? REGION_ID,
  };
}

describe("generateDutySchedule", () => {
  it("assigns only active pharmacies", () => {
    const result = generateDutySchedule({
      month: MONTH,
      year: YEAR,
      regionId: REGION_ID,
      dailyDutyCount: 1,
      dutyRule: BASE_DUTY_RULE,
      pharmacies: [
        pharmacy("active-1"),
        pharmacy("inactive-1", { isActive: false }),
      ],
      holidays: [],
      unavailabilities: [],
      historicalAssignments: [],
    });

    expect(result.assignments.length).toBe(daysInMonth(YEAR, MONTH));
    expect(result.assignments.every((a) => a.pharmacyId === "active-1")).toBe(true);
  });

  it("does not assign pharmacies on unavailable dates", () => {
    const unavailableStart = dateAtUtcMidnight(YEAR, MONTH, 5);
    const unavailableEnd = dateAtUtcMidnight(YEAR, MONTH, 10);

    const result = generateDutySchedule({
      month: MONTH,
      year: YEAR,
      regionId: REGION_ID,
      dailyDutyCount: 1,
      dutyRule: BASE_DUTY_RULE,
      pharmacies: [pharmacy("a"), pharmacy("b")],
      holidays: [],
      unavailabilities: [
        { pharmacyId: "a", startDate: unavailableStart, endDate: unavailableEnd },
      ],
      historicalAssignments: [],
    });

    const duringUnavailability = result.assignments.filter(
      (a) => a.date >= unavailableStart && a.date <= unavailableEnd
    );
    expect(duringUnavailability.every((a) => a.pharmacyId === "b")).toBe(true);
    expect(duringUnavailability.length).toBe(6);
  });

  it("respects the selected region", () => {
    const result = generateDutySchedule({
      month: MONTH,
      year: YEAR,
      regionId: REGION_ID,
      dailyDutyCount: 1,
      dutyRule: BASE_DUTY_RULE,
      pharmacies: [
        pharmacy("in-region"),
        pharmacy("other-region", { regionId: "region-2" }),
      ],
      holidays: [],
      unavailabilities: [],
      historicalAssignments: [],
    });

    expect(result.assignments.every((a) => a.pharmacyId === "in-region")).toBe(true);
  });

  it("creates the correct number of daily assignments when enough pharmacies exist", () => {
    const result = generateDutySchedule({
      month: MONTH,
      year: YEAR,
      regionId: REGION_ID,
      dailyDutyCount: 2,
      dutyRule: BASE_DUTY_RULE,
      pharmacies: [pharmacy("a"), pharmacy("b"), pharmacy("c"), pharmacy("d"), pharmacy("e")],
      holidays: [],
      unavailabilities: [],
      historicalAssignments: [],
    });

    const totalDays = daysInMonth(YEAR, MONTH);
    expect(result.assignments.length).toBe(totalDays * 2);
    expect(result.warnings.length).toBe(0);

    for (let day = 1; day <= totalDays; day++) {
      const date = dateAtUtcMidnight(YEAR, MONTH, day);
      const dayAssignments = result.assignments.filter((a) => a.date.getTime() === date.getTime());
      expect(dayAssignments.length).toBe(2);
      const distinctPharmacies = new Set(dayAssignments.map((a) => a.pharmacyId));
      expect(distinctPharmacies.size).toBe(2);
    }
  });

  it("creates warnings when not enough eligible pharmacies exist", () => {
    const result = generateDutySchedule({
      month: MONTH,
      year: YEAR,
      regionId: REGION_ID,
      dailyDutyCount: 3,
      dutyRule: BASE_DUTY_RULE,
      pharmacies: [pharmacy("only-one")],
      holidays: [],
      unavailabilities: [],
      historicalAssignments: [],
    });

    const totalDays = daysInMonth(YEAR, MONTH);
    expect(result.warnings.length).toBe(totalDays);
    expect(result.warnings.every((w) => w.message === "Bu tarih için yeterli uygun eczane bulunamadı.")).toBe(
      true
    );
    expect(result.assignments.length).toBe(totalDays);
    expect(result.assignments.every((a) => a.pharmacyId === "only-one")).toBe(true);
  });

  it("applies holiday weights, with holiday taking priority over weekend", () => {
    // 2026-03-08 is a Sunday; treat it as an official holiday to confirm
    // the holiday weight wins over the (higher) Sunday weekend weight.
    const holidayDate = dateAtUtcMidnight(YEAR, MONTH, 8);
    expect(holidayDate.getUTCDay()).toBe(0); // Sunday, sanity check

    const result = generateDutySchedule({
      month: MONTH,
      year: YEAR,
      regionId: REGION_ID,
      dailyDutyCount: 1,
      dutyRule: { ...BASE_DUTY_RULE, sundayWeight: 1.5, officialHolidayWeight: 9 },
      pharmacies: [pharmacy("a")],
      holidays: [{ date: holidayDate, name: "Test Tatili", type: "OFFICIAL" }],
      unavailabilities: [],
      historicalAssignments: [],
    });

    const holidayAssignment = result.assignments.find(
      (a) => a.date.getTime() === holidayDate.getTime()
    );
    expect(holidayAssignment?.weight).toBe(9);
    expect(holidayAssignment?.note).toBe("Test Tatili");
  });

  it("updates in-memory fairness metrics so pharmacies alternate instead of one being overused", () => {
    // Keep every day's weight identical so the assignment order is driven
    // purely by the fairness metrics, not by weekday/weekend/holiday weight.
    const equalWeightRule = {
      minDaysBetweenDuties: 0,
      weekdayWeight: 1,
      saturdayWeight: 1,
      sundayWeight: 1,
      officialHolidayWeight: 1,
      religiousHolidayWeight: 1,
    };

    const result = generateDutySchedule({
      month: MONTH,
      year: YEAR,
      regionId: REGION_ID,
      dailyDutyCount: 1,
      dutyRule: equalWeightRule,
      pharmacies: [pharmacy("a"), pharmacy("b")],
      holidays: [],
      unavailabilities: [],
      historicalAssignments: [],
    });

    const totalDays = daysInMonth(YEAR, MONTH);
    expect(result.assignments.length).toBe(totalDays);

    const countsByPharmacy = new Map<string, number>();
    for (const assignment of result.assignments) {
      countsByPharmacy.set(
        assignment.pharmacyId,
        (countsByPharmacy.get(assignment.pharmacyId) ?? 0) + 1
      );
    }
    const counts = Array.from(countsByPharmacy.values());
    expect(counts.length).toBe(2);
    expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(1);

    // The two pharmacies should mostly alternate day-to-day; the only
    // legitimate exception is the weekend-duty fairness tiebreaker, which
    // may repeat a pharmacy across a Saturday/Sunday boundary if it has
    // strictly fewer weekend duties than the alternative.
    let repeats = 0;
    for (let i = 1; i < result.assignments.length; i++) {
      if (result.assignments[i].pharmacyId === result.assignments[i - 1].pharmacyId) {
        repeats += 1;
      }
    }
    expect(repeats).toBeLessThanOrEqual(1);
  });
});
