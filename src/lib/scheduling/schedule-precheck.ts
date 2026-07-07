import { prisma } from "@/lib/prisma";
import { dateAtUtcMidnight, daysInMonth } from "./date-tr";

export type SchedulePreCheckResult = {
  criticalErrors: string[];
  warnings: string[];
  info: string[];
  canGenerate: boolean;
};

export type SchedulePreCheckDutyRequest = {
  pharmacyId: string;
  startDate: Date;
  endDate: Date;
};

export type SchedulePreCheckUnavailability = {
  pharmacyId: string;
  startDate: Date;
  endDate: Date;
};

export type SchedulePreCheckInput = {
  month: number;
  year: number;
  dailyDutyCount: number;
  hasDutyRule: boolean;
  activePharmacies: { id: string }[];
  unavailabilities: SchedulePreCheckUnavailability[];
  // Yalnızca APPROVED + CANNOT_DUTY/EMERGENCY_EXCUSE talepler geçirilmelidir.
  approvedBlockingRequests: SchedulePreCheckDutyRequest[];
  pendingDutyRequestCount: number;
  hasHistoricalRecords: boolean;
  hasHolidays: boolean;
  incompletePharmacyInfoCount: number;
};

/**
 * Çizelge oluşturmadan önce çalıştırılan saf kontrol fonksiyonu. Kritik
 * hatalar varsa çizelge oluşturulmamalıdır (canGenerate: false); uyarılar
 * çizelge oluşturmayı engellemez, yalnızca bilgilendirir.
 */
export function evaluateSchedulePreCheck(
  input: SchedulePreCheckInput
): SchedulePreCheckResult {
  const criticalErrors: string[] = [];
  const warnings: string[] = [];
  const info: string[] = [];

  if (!input.hasDutyRule) {
    criticalErrors.push("Bu bölgede nöbet kuralı tanımlanmamış.");
  }
  if (input.activePharmacies.length < input.dailyDutyCount) {
    criticalErrors.push("Aktif eczane sayısı günlük nöbetçi ihtiyacından az.");
  }

  if (input.hasDutyRule && input.activePharmacies.length >= input.dailyDutyCount) {
    const totalDays = daysInMonth(input.year, input.month);
    let hasImpossibleDate = false;
    for (let day = 1; day <= totalDays && !hasImpossibleDate; day++) {
      const date = dateAtUtcMidnight(input.year, input.month, day);
      let blockedByRequestCount = 0;
      let eligibleCount = 0;
      for (const pharmacy of input.activePharmacies) {
        const unavailable = input.unavailabilities.some(
          (u) =>
            u.pharmacyId === pharmacy.id &&
            u.startDate.getTime() <= date.getTime() &&
            u.endDate.getTime() >= date.getTime()
        );
        const blockedByRequest = input.approvedBlockingRequests.some(
          (r) =>
            r.pharmacyId === pharmacy.id &&
            r.startDate.getTime() <= date.getTime() &&
            r.endDate.getTime() >= date.getTime()
        );
        if (blockedByRequest) blockedByRequestCount += 1;
        if (!unavailable && !blockedByRequest) eligibleCount += 1;
      }
      if (eligibleCount < input.dailyDutyCount && blockedByRequestCount > 0) {
        hasImpossibleDate = true;
      }
    }
    if (hasImpossibleDate) {
      criticalErrors.push(
        "Bu ay bazı tarihlerde uygun eczane sayısı yetersiz olduğu için çizelge oluşturulamaz."
      );
    }
  }

  if (input.pendingDutyRequestCount > 0) {
    warnings.push(
      "Bekleyen nöbet talepleri var. Çizelge oluşturmadan önce incelemeniz önerilir."
    );
  }
  if (!input.hasHistoricalRecords) {
    warnings.push(
      "Bu bölge için geçmiş nöbet verisi bulunmuyor. Çizelge mevcut sistem verilerine göre oluşturulacak."
    );
  }
  if (input.incompletePharmacyInfoCount > 0) {
    warnings.push("Bazı eczanelerde telefon, adres veya harita bilgisi eksik.");
  }
  if (!input.hasHolidays) {
    warnings.push("Tatil günleri tanımlanmamış olabilir.");
  }

  if (input.hasHistoricalRecords) {
    info.push("Geçmiş nöbet yükleri denge skoruna dahil edildi.");
  }
  if (input.approvedBlockingRequests.length > 0) {
    info.push("Onaylı nöbet talepleri çizelge oluşturulurken dikkate alındı.");
  }

  return { criticalErrors, warnings, info, canGenerate: criticalErrors.length === 0 };
}

export type GetSchedulePreCheckInput = {
  regionId: string;
  month: number;
  year: number;
  dailyDutyCount: number;
  hasDutyRule: boolean;
  activePharmacyIds: string[];
};

/**
 * evaluateSchedulePreCheck için gerekli ek verileri (mazeretler, onaylı
 * kesin kısıt talepleri, bekleyen talepler, geçmiş nöbet verisi, tatil
 * günleri, eksik eczane bilgisi) veritabanından çeker.
 */
export async function getSchedulePreCheck(
  params: GetSchedulePreCheckInput
): Promise<SchedulePreCheckResult> {
  const { regionId, month, year, dailyDutyCount, hasDutyRule, activePharmacyIds } = params;

  const monthStart = dateAtUtcMidnight(year, month, 1);
  const monthEnd = dateAtUtcMidnight(year, month, daysInMonth(year, month));

  const [
    unavailabilities,
    approvedBlockingRequests,
    pendingDutyRequestCount,
    historicalRecordCount,
    holidayCount,
    incompletePharmacyInfoCount,
  ] = await Promise.all([
    prisma.unavailability.findMany({
      where: {
        pharmacyId: { in: activePharmacyIds },
        startDate: { lte: monthEnd },
        endDate: { gte: monthStart },
      },
      select: { pharmacyId: true, startDate: true, endDate: true },
    }),
    prisma.dutyRequest.findMany({
      where: {
        pharmacyId: { in: activePharmacyIds },
        status: "APPROVED",
        requestType: { in: ["CANNOT_DUTY", "EMERGENCY_EXCUSE"] },
        startDate: { lte: monthEnd },
        endDate: { gte: monthStart },
      },
      select: { pharmacyId: true, startDate: true, endDate: true },
    }),
    prisma.dutyRequest.count({
      where: { pharmacyId: { in: activePharmacyIds }, status: "PENDING" },
    }),
    prisma.historicalDutyRecord.count({ where: { regionId, matchStatus: "MATCHED" } }),
    prisma.holiday.count({ where: { date: { gte: monthStart, lte: monthEnd } } }),
    prisma.pharmacy.count({
      where: {
        id: { in: activePharmacyIds },
        OR: [{ phone: "" }, { address: "" }, { mapUrl: null }],
      },
    }),
  ]);

  return evaluateSchedulePreCheck({
    month,
    year,
    dailyDutyCount,
    hasDutyRule,
    activePharmacies: activePharmacyIds.map((id) => ({ id })),
    unavailabilities,
    approvedBlockingRequests,
    pendingDutyRequestCount,
    hasHistoricalRecords: historicalRecordCount > 0,
    hasHolidays: holidayCount > 0,
    incompletePharmacyInfoCount,
  });
}
