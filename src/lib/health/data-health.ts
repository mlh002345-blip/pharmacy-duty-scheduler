import { prisma } from "@/lib/prisma";
import { todayAtUtcMidnight } from "@/lib/scheduling/date-tr";

export type HealthSeverity = "CRITICAL" | "WARNING" | "INFO";

export type HealthFinding = {
  severity: HealthSeverity;
  message: string;
  affected?: string;
  linkHref?: string;
  linkLabel?: string;
};

export type RegionHealthInput = {
  id: string;
  name: string;
  isActive: boolean;
  dailyDutyCount: number;
  hasDutyRule: boolean;
  activePharmacyCount: number;
  hasHistoricalRecords: boolean;
};

export type PharmacyHealthInput = {
  id: string;
  name: string;
  regionId: string;
  regionName: string;
  isActive: boolean;
  phone: string | null;
  address: string | null;
  mapUrl: string | null;
};

export type UnavailabilityHealthInput = {
  pharmacyName: string;
  startDate: Date;
  endDate: Date;
};

export type PublishedScheduleSummary = {
  previousMonthCount: number;
  currentMonthCount: number;
  nextMonthCount: number;
};

export type SetupStatusInput = {
  hasRegions: boolean;
  hasPharmacies: boolean;
  hasDutyRules: boolean;
  hasHistoricalData: boolean;
  dutyRequestsReviewed: boolean;
  hasPublishedSchedule: boolean;
};

export type DataHealthCheckInput = {
  regions: RegionHealthInput[];
  pharmacies: PharmacyHealthInput[];
  invalidUnavailabilities: UnavailabilityHealthInput[];
  pendingDutyRequestCount: number;
  unmatchedHistoricalCount: number;
  hasHolidays: boolean;
  publishedSchedules: PublishedScheduleSummary;
  setupStatus: SetupStatusInput;
};

export type DataHealthReport = {
  critical: HealthFinding[];
  warnings: HealthFinding[];
  info: HealthFinding[];
};

const PHARMACY_LINK = { linkHref: "/eczaneler", linkLabel: "Eczaneler" };
const RULE_LINK = { linkHref: "/kurallar", linkLabel: "Nöbet Kuralları" };
const UNAVAILABILITY_LINK = { linkHref: "/mazeretler", linkLabel: "Mazeretler" };
const DUTY_REQUEST_LINK = { linkHref: "/nobet-talepleri", linkLabel: "Nöbet Talepleri" };
const HISTORICAL_LINK = { linkHref: "/gecmis-nobetler", linkLabel: "Geçmiş Nöbetler" };
const HOLIDAY_LINK = { linkHref: "/tatil-gunleri", linkLabel: "Tatil Günleri" };
const REGION_LINK = { linkHref: "/bolgeler", linkLabel: "Nöbet Bölgeleri" };

export function runDataHealthCheck(input: DataHealthCheckInput): DataHealthReport {
  const critical: HealthFinding[] = [];
  const warnings: HealthFinding[] = [];
  const info: HealthFinding[] = [];

  const activeRegions = input.regions.filter((r) => r.isActive);

  for (const region of activeRegions) {
    if (!region.hasDutyRule) {
      critical.push({
        severity: "CRITICAL",
        message: `${region.name} bölgesi için nöbet kuralı tanımlanmamış.`,
        affected: region.name,
        ...RULE_LINK,
      });
    }
    if (region.activePharmacyCount === 0) {
      critical.push({
        severity: "CRITICAL",
        message: `${region.name} bölgesinde aktif eczane bulunmuyor.`,
        affected: region.name,
        ...PHARMACY_LINK,
      });
    } else if (region.activePharmacyCount < region.dailyDutyCount) {
      critical.push({
        severity: "CRITICAL",
        message: `${region.name} bölgesinde aktif eczane sayısı günlük nöbetçi ihtiyacından az.`,
        affected: region.name,
        ...PHARMACY_LINK,
      });
    }
    if (!region.hasHistoricalRecords) {
      warnings.push({
        severity: "WARNING",
        message: `${region.name} bölgesi için geçmiş nöbet verisi bulunmuyor.`,
        affected: region.name,
        ...HISTORICAL_LINK,
      });
    }
  }

  for (const u of input.invalidUnavailabilities) {
    critical.push({
      severity: "CRITICAL",
      message: `${u.pharmacyName} için mazeret bitiş tarihi başlangıç tarihinden önce.`,
      affected: u.pharmacyName,
      ...UNAVAILABILITY_LINK,
    });
  }

  // Aynı bölgede aynı isimle birden fazla eczane kaydı.
  const byRegionAndName = new Map<
    string,
    { regionName: string; name: string; count: number }
  >();
  for (const p of input.pharmacies) {
    const key = `${p.regionId}::${p.name.trim()}`;
    const existing = byRegionAndName.get(key);
    if (existing) existing.count += 1;
    else byRegionAndName.set(key, { regionName: p.regionName, name: p.name.trim(), count: 1 });
  }
  for (const { regionName, name, count } of byRegionAndName.values()) {
    if (count > 1) {
      critical.push({
        severity: "CRITICAL",
        message: `${regionName} bölgesinde aynı isimle birden fazla eczane kaydı var: ${name}`,
        affected: name,
        ...PHARMACY_LINK,
      });
    }
  }

  for (const p of input.pharmacies) {
    if (!p.isActive) continue;
    if (!p.phone) {
      warnings.push({
        severity: "WARNING",
        message: `${p.name} için telefon bilgisi eksik.`,
        affected: p.name,
        ...PHARMACY_LINK,
      });
    }
    if (!p.address) {
      warnings.push({
        severity: "WARNING",
        message: `${p.name} için adres bilgisi eksik.`,
        affected: p.name,
        ...PHARMACY_LINK,
      });
    }
    if (!p.mapUrl) {
      warnings.push({
        severity: "WARNING",
        message: `${p.name} için harita linki eksik.`,
        affected: p.name,
        ...PHARMACY_LINK,
      });
    }
  }

  if (input.pendingDutyRequestCount > 0) {
    warnings.push({
      severity: "WARNING",
      message: `İncelenmeyi bekleyen ${input.pendingDutyRequestCount} nöbet talebi var.`,
      ...DUTY_REQUEST_LINK,
    });
  }

  if (input.unmatchedHistoricalCount > 0) {
    warnings.push({
      severity: "WARNING",
      message: `Geçmiş nöbet aktarımında eşleşmeyen ${input.unmatchedHistoricalCount} kayıt var. Bu kayıtlar denge skoruna dahil edilmez.`,
      ...HISTORICAL_LINK,
    });
  }

  if (!input.hasHolidays) {
    warnings.push({
      severity: "WARNING",
      message:
        "Tatil günleri tanımlanmamış. Resmî tatil ve bayram nöbet ağırlıkları eksik hesaplanabilir.",
      ...HOLIDAY_LINK,
    });
  }

  const { previousMonthCount, currentMonthCount, nextMonthCount } = input.publishedSchedules;
  info.push({
    severity: "INFO",
    message:
      previousMonthCount > 0
        ? `Geçen ay yayında ${previousMonthCount} çizelge var.`
        : "Geçen ay için yayınlanmış çizelge yok.",
  });
  info.push({
    severity: "INFO",
    message:
      currentMonthCount > 0
        ? `Bu ay yayında ${currentMonthCount} çizelge var.`
        : "Bu ay için henüz yayınlanmış çizelge yok.",
  });
  info.push({
    severity: "INFO",
    message:
      nextMonthCount > 0
        ? `Gelecek ay yayında ${nextMonthCount} çizelge var.`
        : "Gelecek ay için henüz yayınlanmış çizelge yok.",
  });

  const s = input.setupStatus;
  info.push({
    severity: "INFO",
    message: s.hasRegions ? "Bölgeler tanımlı." : "Henüz bölge tanımlanmamış.",
    ...REGION_LINK,
  });
  info.push({
    severity: "INFO",
    message: s.hasPharmacies ? "Eczaneler eklendi." : "Henüz eczane eklenmemiş.",
    ...PHARMACY_LINK,
  });
  info.push({
    severity: "INFO",
    message: s.hasDutyRules ? "Nöbet kuralları tanımlı." : "Nöbet kuralları tanımlanmamış.",
    ...RULE_LINK,
  });
  info.push({
    severity: "INFO",
    message: s.hasHistoricalData
      ? "Geçmiş nöbet verisi mevcut."
      : "Geçmiş nöbet verisi bulunmuyor.",
    ...HISTORICAL_LINK,
  });
  info.push({
    severity: "INFO",
    message: s.dutyRequestsReviewed
      ? "Bekleyen nöbet talebi yok."
      : "İncelenmeyi bekleyen nöbet talebi var.",
    ...DUTY_REQUEST_LINK,
  });
  info.push({
    severity: "INFO",
    message: s.hasPublishedSchedule
      ? "En az bir yayınlanmış çizelge var."
      : "Henüz yayınlanmış çizelge yok.",
  });

  return { critical, warnings, info };
}

export async function getDataHealthReport(): Promise<DataHealthReport> {
  const today = todayAtUtcMidnight();
  const currentMonth = today.getUTCMonth() + 1;
  const currentYear = today.getUTCFullYear();
  const prevMonthDate = new Date(Date.UTC(currentYear, currentMonth - 2, 1));
  const nextMonthDate = new Date(Date.UTC(currentYear, currentMonth, 1));

  const [
    regions,
    pharmacies,
    unavailabilities,
    pendingDutyRequestCount,
    unmatchedHistoricalCount,
    holidayCount,
    dutyRuleCount,
    historicalRecordCount,
    historicalRegionGroups,
    previousMonthCount,
    currentMonthCount,
    nextMonthCount,
    publishedScheduleCount,
  ] = await Promise.all([
    prisma.region.findMany({
      select: {
        id: true,
        name: true,
        isActive: true,
        dailyDutyCount: true,
        dutyRule: { select: { id: true } },
        pharmacies: { where: { isActive: true }, select: { id: true } },
      },
    }),
    prisma.pharmacy.findMany({
      select: {
        id: true,
        name: true,
        regionId: true,
        region: { select: { name: true } },
        isActive: true,
        phone: true,
        address: true,
        mapUrl: true,
      },
    }),
    prisma.unavailability.findMany({
      select: { startDate: true, endDate: true, pharmacy: { select: { name: true } } },
    }),
    prisma.dutyRequest.count({ where: { status: "PENDING" } }),
    prisma.historicalDutyRecord.count({ where: { matchStatus: "UNMATCHED" } }),
    prisma.holiday.count(),
    prisma.dutyRule.count(),
    prisma.historicalDutyRecord.count(),
    prisma.historicalDutyRecord.groupBy({
      by: ["regionId"],
      where: { matchStatus: "MATCHED", regionId: { not: null } },
      _count: { _all: true },
    }),
    prisma.dutySchedule.count({
      where: {
        status: "PUBLISHED",
        month: prevMonthDate.getUTCMonth() + 1,
        year: prevMonthDate.getUTCFullYear(),
      },
    }),
    prisma.dutySchedule.count({
      where: { status: "PUBLISHED", month: currentMonth, year: currentYear },
    }),
    prisma.dutySchedule.count({
      where: {
        status: "PUBLISHED",
        month: nextMonthDate.getUTCMonth() + 1,
        year: nextMonthDate.getUTCFullYear(),
      },
    }),
    prisma.dutySchedule.count({ where: { status: "PUBLISHED" } }),
  ]);

  const regionsWithHistorical = new Set(
    historicalRegionGroups.map((g) => g.regionId as string)
  );

  const input: DataHealthCheckInput = {
    regions: regions.map((r) => ({
      id: r.id,
      name: r.name,
      isActive: r.isActive,
      dailyDutyCount: r.dailyDutyCount,
      hasDutyRule: !!r.dutyRule,
      activePharmacyCount: r.pharmacies.length,
      hasHistoricalRecords: regionsWithHistorical.has(r.id),
    })),
    pharmacies: pharmacies.map((p) => ({
      id: p.id,
      name: p.name,
      regionId: p.regionId,
      regionName: p.region.name,
      isActive: p.isActive,
      phone: p.phone || null,
      address: p.address || null,
      mapUrl: p.mapUrl,
    })),
    invalidUnavailabilities: unavailabilities
      .filter((u) => u.endDate.getTime() < u.startDate.getTime())
      .map((u) => ({
        pharmacyName: u.pharmacy.name,
        startDate: u.startDate,
        endDate: u.endDate,
      })),
    pendingDutyRequestCount,
    unmatchedHistoricalCount,
    hasHolidays: holidayCount > 0,
    publishedSchedules: { previousMonthCount, currentMonthCount, nextMonthCount },
    setupStatus: {
      hasRegions: regions.some((r) => r.isActive),
      hasPharmacies: pharmacies.length > 0,
      hasDutyRules: dutyRuleCount > 0,
      hasHistoricalData: historicalRecordCount > 0,
      dutyRequestsReviewed: pendingDutyRequestCount === 0,
      hasPublishedSchedule: publishedScheduleCount > 0,
    },
  };

  return runDataHealthCheck(input);
}
