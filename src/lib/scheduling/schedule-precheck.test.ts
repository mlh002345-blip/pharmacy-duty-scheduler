import { describe, expect, it } from "vitest";

import { evaluateSchedulePreCheck, type SchedulePreCheckInput } from "./schedule-precheck";
import { dateAtUtcMidnight } from "./date-tr";

const MONTH = 3;
const YEAR = 2026;

function baseInput(overrides: Partial<SchedulePreCheckInput> = {}): SchedulePreCheckInput {
  return {
    month: MONTH,
    year: YEAR,
    dailyDutyCount: 1,
    hasDutyRule: true,
    activePharmacies: [{ id: "a" }, { id: "b" }],
    unavailabilities: [],
    approvedBlockingRequests: [],
    pendingDutyRequestCount: 0,
    hasHistoricalRecords: true,
    hasHolidays: true,
    incompletePharmacyInfoCount: 0,
    ...overrides,
  };
}

describe("evaluateSchedulePreCheck", () => {
  it("blocks generation when the region has no duty rule", () => {
    const result = evaluateSchedulePreCheck(baseInput({ hasDutyRule: false }));
    expect(result.canGenerate).toBe(false);
    expect(result.criticalErrors).toContain("Bu bölgede nöbet kuralı tanımlanmamış.");
  });

  it("blocks generation when active pharmacy count is below dailyDutyCount", () => {
    const result = evaluateSchedulePreCheck(
      baseInput({ dailyDutyCount: 3, activePharmacies: [{ id: "a" }, { id: "b" }] })
    );
    expect(result.canGenerate).toBe(false);
    expect(result.criticalErrors).toContain("Aktif eczane sayısı günlük nöbetçi ihtiyacından az.");
  });

  it("blocks generation when zero active pharmacies exist", () => {
    const result = evaluateSchedulePreCheck(baseInput({ activePharmacies: [] }));
    expect(result.canGenerate).toBe(false);
    expect(result.criticalErrors).toContain("Aktif eczane sayısı günlük nöbetçi ihtiyacından az.");
  });

  it("blocks generation when approved CANNOT_DUTY requests make a date impossible", () => {
    // dailyDutyCount 2, only two active pharmacies; if both are blocked by
    // an approved CANNOT_DUTY request on the same day, zero remain.
    const blockedDate = dateAtUtcMidnight(YEAR, MONTH, 10);
    const result = evaluateSchedulePreCheck(
      baseInput({
        dailyDutyCount: 2,
        activePharmacies: [{ id: "a" }, { id: "b" }, { id: "c" }],
        approvedBlockingRequests: [
          { pharmacyId: "a", startDate: blockedDate, endDate: blockedDate },
          { pharmacyId: "b", startDate: blockedDate, endDate: blockedDate },
        ],
      })
    );
    expect(result.canGenerate).toBe(false);
    expect(result.criticalErrors).toContain(
      "Bu ay bazı tarihlerde uygun eczane sayısı yetersiz olduğu için çizelge oluşturulamaz."
    );
  });

  it("does not block when approved requests still leave enough eligible pharmacies", () => {
    const blockedDate = dateAtUtcMidnight(YEAR, MONTH, 10);
    const result = evaluateSchedulePreCheck(
      baseInput({
        dailyDutyCount: 1,
        activePharmacies: [{ id: "a" }, { id: "b" }, { id: "c" }],
        approvedBlockingRequests: [
          { pharmacyId: "a", startDate: blockedDate, endDate: blockedDate },
        ],
      })
    );
    expect(result.canGenerate).toBe(true);
    expect(result.criticalErrors).toEqual([]);
  });

  it("does not block on unavailability alone (only approved duty requests trigger the impossible-date check)", () => {
    const blockedDate = dateAtUtcMidnight(YEAR, MONTH, 10);
    const result = evaluateSchedulePreCheck(
      baseInput({
        dailyDutyCount: 2,
        activePharmacies: [{ id: "a" }, { id: "b" }],
        unavailabilities: [
          { pharmacyId: "a", startDate: blockedDate, endDate: blockedDate },
          { pharmacyId: "b", startDate: blockedDate, endDate: blockedDate },
        ],
      })
    );
    expect(result.canGenerate).toBe(true);
  });

  it("allows generation with only warnings present (pending requests, missing historical data, missing holidays, incomplete info)", () => {
    const result = evaluateSchedulePreCheck(
      baseInput({
        pendingDutyRequestCount: 2,
        hasHistoricalRecords: false,
        hasHolidays: false,
        incompletePharmacyInfoCount: 5,
      })
    );
    expect(result.canGenerate).toBe(true);
    expect(result.criticalErrors).toEqual([]);
    expect(result.warnings).toContain(
      "Bekleyen nöbet talepleri var. Çizelge oluşturmadan önce incelemeniz önerilir."
    );
    expect(result.warnings).toContain(
      "Bu bölge için geçmiş nöbet verisi bulunmuyor. Çizelge mevcut sistem verilerine göre oluşturulacak."
    );
    expect(result.warnings).toContain("Bazı eczanelerde telefon, adres veya harita bilgisi eksik.");
    expect(result.warnings).toContain("Tatil günleri tanımlanmamış olabilir.");
  });

  it("includes info messages when historical data and approved requests are present", () => {
    const result = evaluateSchedulePreCheck(
      baseInput({
        hasHistoricalRecords: true,
        approvedBlockingRequests: [
          {
            pharmacyId: "a",
            startDate: dateAtUtcMidnight(YEAR, MONTH, 5),
            endDate: dateAtUtcMidnight(YEAR, MONTH, 6),
          },
        ],
      })
    );
    expect(result.info).toContain("Geçmiş nöbet yükleri denge skoruna dahil edildi.");
    expect(result.info).toContain("Onaylı nöbet talepleri çizelge oluşturulurken dikkate alındı.");
  });

  it("has no warnings or info when everything is clean and no historical/requests exist", () => {
    const result = evaluateSchedulePreCheck(baseInput({ hasHistoricalRecords: false }));
    expect(result.warnings).toContain(
      "Bu bölge için geçmiş nöbet verisi bulunmuyor. Çizelge mevcut sistem verilerine göre oluşturulacak."
    );
    expect(result.info).toEqual([]);
  });
});
