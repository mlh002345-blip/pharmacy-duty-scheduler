import { describe, expect, it } from "vitest";

import { runDataHealthCheck, type DataHealthCheckInput } from "./data-health";

function baseInput(overrides: Partial<DataHealthCheckInput> = {}): DataHealthCheckInput {
  return {
    regions: [],
    pharmacies: [],
    invalidUnavailabilities: [],
    pendingDutyRequestCount: 0,
    unmatchedHistoricalCount: 0,
    hasHolidays: true,
    publishedSchedules: { previousMonthCount: 0, currentMonthCount: 0, nextMonthCount: 0 },
    setupStatus: {
      hasRegions: true,
      hasPharmacies: true,
      hasDutyRules: true,
      hasHistoricalData: true,
      dutyRequestsReviewed: true,
      hasPublishedSchedule: true,
    },
    ...overrides,
  };
}

describe("runDataHealthCheck", () => {
  it("detects an active region without a duty rule", () => {
    const report = runDataHealthCheck(
      baseInput({
        regions: [
          {
            id: "r1",
            name: "Kadıköy",
            isActive: true,
            dailyDutyCount: 1,
            hasDutyRule: false,
            activePharmacyCount: 5,
            hasHistoricalRecords: true,
          },
        ],
      })
    );
    expect(
      report.critical.some((f) => f.message === "Kadıköy bölgesi için nöbet kuralı tanımlanmamış.")
    ).toBe(true);
  });

  it("does not flag an inactive region missing a duty rule", () => {
    const report = runDataHealthCheck(
      baseInput({
        regions: [
          {
            id: "r1",
            name: "Kadıköy",
            isActive: false,
            dailyDutyCount: 1,
            hasDutyRule: false,
            activePharmacyCount: 0,
            hasHistoricalRecords: true,
          },
        ],
      })
    );
    expect(report.critical.length).toBe(0);
  });

  it("detects zero active pharmacies in an active region", () => {
    const report = runDataHealthCheck(
      baseInput({
        regions: [
          {
            id: "r1",
            name: "Üsküdar",
            isActive: true,
            dailyDutyCount: 1,
            hasDutyRule: true,
            activePharmacyCount: 0,
            hasHistoricalRecords: true,
          },
        ],
      })
    );
    expect(
      report.critical.some((f) => f.message === "Üsküdar bölgesinde aktif eczane bulunmuyor.")
    ).toBe(true);
  });

  it("detects active pharmacy count lower than dailyDutyCount", () => {
    const report = runDataHealthCheck(
      baseInput({
        regions: [
          {
            id: "r1",
            name: "Şişli",
            isActive: true,
            dailyDutyCount: 3,
            hasDutyRule: true,
            activePharmacyCount: 2,
            hasHistoricalRecords: true,
          },
        ],
      })
    );
    expect(
      report.critical.some(
        (f) => f.message === "Şişli bölgesinde aktif eczane sayısı günlük nöbetçi ihtiyacından az."
      )
    ).toBe(true);
  });

  it("does not flag sufficient active pharmacy count", () => {
    const report = runDataHealthCheck(
      baseInput({
        regions: [
          {
            id: "r1",
            name: "Şişli",
            isActive: true,
            dailyDutyCount: 2,
            hasDutyRule: true,
            activePharmacyCount: 2,
            hasHistoricalRecords: true,
          },
        ],
      })
    );
    expect(report.critical.length).toBe(0);
  });

  it("detects an unavailability with endDate before startDate", () => {
    const report = runDataHealthCheck(
      baseInput({
        invalidUnavailabilities: [
          {
            pharmacyName: "Deva Eczanesi",
            startDate: new Date("2026-05-10"),
            endDate: new Date("2026-05-05"),
          },
        ],
      })
    );
    expect(
      report.critical.some(
        (f) => f.message === "Deva Eczanesi için mazeret bitiş tarihi başlangıç tarihinden önce."
      )
    ).toBe(true);
  });

  it("detects duplicate pharmacy names within the same region", () => {
    const report = runDataHealthCheck(
      baseInput({
        pharmacies: [
          {
            id: "p1",
            name: "Merkez Eczanesi",
            regionId: "r1",
            regionName: "Kadıköy",
            isActive: true,
            phone: "0212",
            address: "Adres",
            mapUrl: "https://maps",
          },
          {
            id: "p2",
            name: "Merkez Eczanesi",
            regionId: "r1",
            regionName: "Kadıköy",
            isActive: true,
            phone: "0212",
            address: "Adres",
            mapUrl: "https://maps",
          },
        ],
      })
    );
    expect(
      report.critical.some(
        (f) =>
          f.message ===
          "Kadıköy bölgesinde aynı isimle birden fazla eczane kaydı var: Merkez Eczanesi"
      )
    ).toBe(true);
  });

  it("does not flag same-name pharmacies in different regions", () => {
    const report = runDataHealthCheck(
      baseInput({
        pharmacies: [
          {
            id: "p1",
            name: "Merkez Eczanesi",
            regionId: "r1",
            regionName: "Kadıköy",
            isActive: true,
            phone: "0212",
            address: "Adres",
            mapUrl: "https://maps",
          },
          {
            id: "p2",
            name: "Merkez Eczanesi",
            regionId: "r2",
            regionName: "Üsküdar",
            isActive: true,
            phone: "0212",
            address: "Adres",
            mapUrl: "https://maps",
          },
        ],
      })
    );
    expect(report.critical.length).toBe(0);
  });

  it("warns on pharmacies missing phone, address, or mapUrl (active only)", () => {
    const report = runDataHealthCheck(
      baseInput({
        pharmacies: [
          {
            id: "p1",
            name: "Eksik Eczanesi",
            regionId: "r1",
            regionName: "Kadıköy",
            isActive: true,
            phone: null,
            address: null,
            mapUrl: null,
          },
          {
            id: "p2",
            name: "Pasif Eczane",
            regionId: "r1",
            regionName: "Kadıköy",
            isActive: false,
            phone: null,
            address: null,
            mapUrl: null,
          },
        ],
      })
    );
    expect(report.warnings.some((f) => f.message === "Eksik Eczanesi için telefon bilgisi eksik.")).toBe(
      true
    );
    expect(report.warnings.some((f) => f.message === "Eksik Eczanesi için adres bilgisi eksik.")).toBe(
      true
    );
    expect(
      report.warnings.some((f) => f.message === "Eksik Eczanesi için harita linki eksik.")
    ).toBe(true);
    expect(report.warnings.some((f) => f.message.includes("Pasif Eczane"))).toBe(false);
  });

  it("detects pending duty requests", () => {
    const report = runDataHealthCheck(baseInput({ pendingDutyRequestCount: 3 }));
    expect(
      report.warnings.some((f) => f.message === "İncelenmeyi bekleyen 3 nöbet talebi var.")
    ).toBe(true);
  });

  it("detects unmatched historical records", () => {
    const report = runDataHealthCheck(baseInput({ unmatchedHistoricalCount: 2 }));
    expect(
      report.warnings.some(
        (f) =>
          f.message ===
          "Geçmiş nöbet aktarımında eşleşmeyen 2 kayıt var. Bu kayıtlar denge skoruna dahil edilmez."
      )
    ).toBe(true);
  });

  it("warns when no holidays are defined", () => {
    const report = runDataHealthCheck(baseInput({ hasHolidays: false }));
    expect(
      report.warnings.some((f) =>
        f.message.startsWith("Tatil günleri tanımlanmamış.")
      )
    ).toBe(true);
  });

  it("includes published schedule summary and setup status as info findings", () => {
    const report = runDataHealthCheck(
      baseInput({
        publishedSchedules: { previousMonthCount: 1, currentMonthCount: 0, nextMonthCount: 2 },
      })
    );
    expect(report.info.some((f) => f.message === "Geçen ay yayında 1 çizelge var.")).toBe(true);
    expect(
      report.info.some((f) => f.message === "Bu ay için henüz yayınlanmış çizelge yok.")
    ).toBe(true);
    expect(report.info.some((f) => f.message === "Gelecek ay yayında 2 çizelge var.")).toBe(true);
  });
});
