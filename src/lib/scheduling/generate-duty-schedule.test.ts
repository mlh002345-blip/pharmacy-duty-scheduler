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

  it("respects multiple separate unavailability windows for the same pharmacy", () => {
    const firstStart = dateAtUtcMidnight(YEAR, MONTH, 2);
    const firstEnd = dateAtUtcMidnight(YEAR, MONTH, 3);
    const secondStart = dateAtUtcMidnight(YEAR, MONTH, 20);
    const secondEnd = dateAtUtcMidnight(YEAR, MONTH, 21);

    const result = generateDutySchedule({
      month: MONTH,
      year: YEAR,
      regionId: REGION_ID,
      dailyDutyCount: 1,
      dutyRule: BASE_DUTY_RULE,
      pharmacies: [pharmacy("a"), pharmacy("b")],
      holidays: [],
      unavailabilities: [
        { pharmacyId: "a", startDate: firstStart, endDate: firstEnd },
        { pharmacyId: "a", startDate: secondStart, endDate: secondEnd },
      ],
      historicalAssignments: [],
    });

    const duringEitherWindow = result.assignments.filter(
      (a) =>
        (a.date >= firstStart && a.date <= firstEnd) ||
        (a.date >= secondStart && a.date <= secondEnd)
    );
    expect(duringEitherWindow.length).toBe(4);
    expect(duringEitherWindow.every((a) => a.pharmacyId === "b")).toBe(true);
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

describe("generateDutySchedule — başlangıç nöbet dengesi (geçmiş yük)", () => {
  it("includes opening balance (historical load) in assignment priority", () => {
    // "yuklu" eczanesi yüksek başlangıç yüküyle başlar; yük eşitlenene
    // kadar öncelik "yeni" eczanede olmalıdır.
    const result = generateDutySchedule({
      month: MONTH,
      year: YEAR,
      regionId: REGION_ID,
      dailyDutyCount: 1,
      dutyRule: BASE_DUTY_RULE,
      pharmacies: [pharmacy("yuklu"), pharmacy("yeni")],
      holidays: [],
      unavailabilities: [],
      historicalAssignments: [],
      openingBalance: new Map([
        ["yuklu", 10],
        ["yeni", 0],
      ]),
    });

    const firstFive = result.assignments.slice(0, 5);
    expect(firstFive.every((a) => a.pharmacyId === "yeni")).toBe(true);
    const yeniCount = result.assignments.filter((a) => a.pharmacyId === "yeni").length;
    const yukluCount = result.assignments.filter((a) => a.pharmacyId === "yuklu").length;
    expect(yeniCount).toBeGreaterThan(yukluCount);
    expect(result.info.join(" ")).toContain(
      "Geçmiş nöbet yükleri denge skoruna dahil edildi."
    );
  });

  it("does not emit the historical info message when opening balance is empty", () => {
    const result = generateDutySchedule({
      month: MONTH,
      year: YEAR,
      regionId: REGION_ID,
      dailyDutyCount: 1,
      dutyRule: BASE_DUTY_RULE,
      pharmacies: [pharmacy("a"), pharmacy("b")],
      holidays: [],
      unavailabilities: [],
      historicalAssignments: [],
    });
    expect(result.info).toEqual([]);
  });

  it("opening balance never adds assignments — historical records stay out of the schedule", () => {
    const result = generateDutySchedule({
      month: MONTH,
      year: YEAR,
      regionId: REGION_ID,
      dailyDutyCount: 1,
      dutyRule: BASE_DUTY_RULE,
      pharmacies: [pharmacy("a"), pharmacy("b")],
      holidays: [],
      unavailabilities: [],
      historicalAssignments: [],
      openingBalance: new Map([
        ["a", 42],
        ["b", 3],
      ]),
    });
    // Atama sayısı yalnızca ay günü kadardır; geçmiş kayıtlar atamaya dönüşmez.
    expect(result.assignments.length).toBe(daysInMonth(YEAR, MONTH));
  });
});

describe("generateDutySchedule — nöbet talepleri", () => {
  it("blocks assignment during an approved CANNOT_DUTY request date range", () => {
    const blockedStart = dateAtUtcMidnight(YEAR, MONTH, 5);
    const blockedEnd = dateAtUtcMidnight(YEAR, MONTH, 10);

    const result = generateDutySchedule({
      month: MONTH,
      year: YEAR,
      regionId: REGION_ID,
      dailyDutyCount: 1,
      dutyRule: BASE_DUTY_RULE,
      pharmacies: [pharmacy("a"), pharmacy("b")],
      holidays: [],
      unavailabilities: [],
      historicalAssignments: [],
      dutyRequests: [
        {
          pharmacyId: "a",
          requestType: "CANNOT_DUTY",
          status: "APPROVED",
          startDate: blockedStart,
          endDate: blockedEnd,
        },
      ],
    });

    const duringBlock = result.assignments.filter(
      (a) => a.date >= blockedStart && a.date <= blockedEnd
    );
    expect(duringBlock.every((a) => a.pharmacyId === "b")).toBe(true);
    expect(duringBlock.length).toBe(6);
    expect(result.info.join(" ")).toContain(
      "Onaylı nöbet talepleri çizelge oluşturulurken dikkate alındı."
    );
  });

  it("blocks assignment during an approved EMERGENCY_EXCUSE request date range", () => {
    const blockedDate = dateAtUtcMidnight(YEAR, MONTH, 12);

    const result = generateDutySchedule({
      month: MONTH,
      year: YEAR,
      regionId: REGION_ID,
      dailyDutyCount: 1,
      dutyRule: BASE_DUTY_RULE,
      pharmacies: [pharmacy("a"), pharmacy("b")],
      holidays: [],
      unavailabilities: [],
      historicalAssignments: [],
      dutyRequests: [
        {
          pharmacyId: "a",
          requestType: "EMERGENCY_EXCUSE",
          status: "APPROVED",
          startDate: blockedDate,
          endDate: blockedDate,
        },
      ],
    });

    const onBlockedDate = result.assignments.find(
      (a) => a.date.getTime() === blockedDate.getTime()
    );
    expect(onBlockedDate?.pharmacyId).toBe("b");
  });

  it("does not block assignment for PENDING or REJECTED requests", () => {
    const requestedStart = dateAtUtcMidnight(YEAR, MONTH, 5);
    const requestedEnd = dateAtUtcMidnight(YEAR, MONTH, 6);

    for (const status of ["PENDING", "REJECTED", "CANCELLED", "LATE"] as const) {
      const result = generateDutySchedule({
        month: MONTH,
        year: YEAR,
        regionId: REGION_ID,
        dailyDutyCount: 1,
        dutyRule: BASE_DUTY_RULE,
        pharmacies: [pharmacy("only-one")],
        holidays: [],
        unavailabilities: [],
        historicalAssignments: [],
        dutyRequests: [
          {
            pharmacyId: "only-one",
            requestType: "CANNOT_DUTY",
            status,
            startDate: requestedStart,
            endDate: requestedEnd,
          },
        ],
      });

      const inRange = result.assignments.filter(
        (a) => a.date >= requestedStart && a.date <= requestedEnd
      );
      expect(inRange.every((a) => a.pharmacyId === "only-one")).toBe(true);
      expect(inRange.length).toBe(2);
    }
  });

  it("prefers a pharmacy with an approved PREFER_DUTY request when load is tied", () => {
    const equalWeightRule = {
      minDaysBetweenDuties: 0,
      weekdayWeight: 1,
      saturdayWeight: 1,
      sundayWeight: 1,
      officialHolidayWeight: 1,
      religiousHolidayWeight: 1,
    };
    const preferredDate = dateAtUtcMidnight(YEAR, MONTH, 1);

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
      dutyRequests: [
        {
          pharmacyId: "b",
          requestType: "PREFER_DUTY",
          status: "APPROVED",
          startDate: preferredDate,
          endDate: preferredDate,
        },
      ],
    });

    const firstDay = result.assignments.find(
      (a) => a.date.getTime() === preferredDate.getTime()
    );
    expect(firstDay?.pharmacyId).toBe("b");
  });

  it("does not emit the duty-request info message when there are no approved blocking requests", () => {
    const result = generateDutySchedule({
      month: MONTH,
      year: YEAR,
      regionId: REGION_ID,
      dailyDutyCount: 1,
      dutyRule: BASE_DUTY_RULE,
      pharmacies: [pharmacy("a"), pharmacy("b")],
      holidays: [],
      unavailabilities: [],
      historicalAssignments: [],
      dutyRequests: [
        {
          pharmacyId: "a",
          requestType: "CANNOT_DUTY",
          status: "PENDING",
          startDate: dateAtUtcMidnight(YEAR, MONTH, 1),
          endDate: dateAtUtcMidnight(YEAR, MONTH, 1),
        },
      ],
    });
    expect(result.info).toEqual([]);
  });
});
