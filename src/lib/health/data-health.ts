import { prisma } from "@/lib/prisma";
import { normalizeText } from "@/lib/historical/normalize";
import { getTurkishMonthName, todayAtUtcMidnight } from "@/lib/scheduling/date-tr";
import { evaluateRegionHealth } from "./region-health";

// Veri Sağlık Kontrolü: çizelge oluşturmadan önce bölge, eczane, kural ve
// veri tutarlılığını denetler. Sonuçlar Kritik / Uyarı / Bilgi olarak gruplanır.

export type HealthCheckItem = {
  severity: "CRITICAL" | "WARNING" | "INFO";
  title: string;
  details: string[];
};

export type DataHealthReport = {
  critical: HealthCheckItem[];
  warnings: HealthCheckItem[];
  info: HealthCheckItem[];
};

function pushItem(
  report: DataHealthReport,
  severity: HealthCheckItem["severity"],
  title: string,
  details: string[] = []
) {
  const item = { severity, title, details };
  if (severity === "CRITICAL") report.critical.push(item);
  else if (severity === "WARNING") report.warnings.push(item);
  else report.info.push(item);
}

export async function runDataHealthChecks(): Promise<DataHealthReport> {
  const report: DataHealthReport = { critical: [], warnings: [], info: [] };

  const today = todayAtUtcMidnight();
  const currentMonth = today.getUTCMonth() + 1;
  const currentYear = today.getUTCFullYear();
  const prevMonth = currentMonth === 1 ? 12 : currentMonth - 1;
  const prevYear = currentMonth === 1 ? currentYear - 1 : currentYear;
  const nextMonth = currentMonth === 12 ? 1 : currentMonth + 1;
  const nextYear = currentMonth === 12 ? currentYear + 1 : currentYear;

  const [
    regions,
    pharmacies,
    invalidUnavailabilities,
    holidays,
    publishedSchedules,
    pendingRequestCount,
    unmatchedHistoricalCount,
  ] = await Promise.all([
    prisma.region.findMany({
      select: {
        name: true,
        isActive: true,
        dailyDutyCount: true,
        dutyRule: { select: { id: true } },
        _count: { select: { pharmacies: { where: { isActive: true } } } },
      },
    }),
    prisma.pharmacy.findMany({
      where: { isActive: true },
      select: {
        name: true,
        phone: true,
        address: true,
        mapUrl: true,
        regionId: true,
        region: { select: { name: true } },
      },
    }),
    prisma.unavailability.findMany({
      select: {
        startDate: true,
        endDate: true,
        pharmacy: { select: { name: true } },
      },
    }),
    prisma.holiday.findMany({ select: { name: true, date: true, type: true } }),
    prisma.dutySchedule.findMany({
      where: {
        status: "PUBLISHED",
        OR: [
          { month: prevMonth, year: prevYear },
          { month: currentMonth, year: currentYear },
          { month: nextMonth, year: nextYear },
        ],
      },
      select: { month: true, year: true, region: { select: { name: true } } },
    }),
    prisma.dutyRequest.count({
      where: { status: "PENDING", endDate: { gte: today } },
    }),
    prisma.historicalDutyRecord.count({ where: { matchStatus: "UNMATCHED" } }),
  ]);

  // 1-3. Bölge kontrolleri (kural, aktif eczane, günlük ihtiyaç)
  for (const region of regions) {
    const issues = evaluateRegionHealth({
      name: region.name,
      isActive: region.isActive,
      dailyDutyCount: region.dailyDutyCount,
      activePharmacyCount: region._count.pharmacies,
      hasDutyRule: !!region.dutyRule,
    });
    for (const issue of issues) {
      pushItem(report, issue.severity, issue.message);
    }
  }

  // 4-6. Eczane iletişim/adres/harita eksikleri
  const missingPhone = pharmacies.filter((p) => !p.phone.trim());
  const missingAddress = pharmacies.filter((p) => !p.address.trim());
  const missingMapUrl = pharmacies.filter((p) => !p.mapUrl?.trim());
  if (missingPhone.length > 0) {
    pushItem(
      report,
      "WARNING",
      `${missingPhone.length} eczanenin telefon bilgisi eksik.`,
      missingPhone.slice(0, 10).map((p) => p.name)
    );
  }
  if (missingAddress.length > 0) {
    pushItem(
      report,
      "WARNING",
      `${missingAddress.length} eczanenin adres bilgisi eksik.`,
      missingAddress.slice(0, 10).map((p) => p.name)
    );
  }
  if (missingMapUrl.length > 0) {
    pushItem(
      report,
      "INFO",
      `${missingMapUrl.length} eczanenin harita bağlantısı yok; vatandaş ekranında ad/adres araması kullanılacak.`,
      missingMapUrl.slice(0, 10).map((p) => p.name)
    );
  }

  // 7. Aynı bölgede yinelenen eczane adları
  const nameCounts = new Map<string, { count: number; label: string }>();
  for (const pharmacy of pharmacies) {
    const key = `${normalizeText(pharmacy.name)}|${pharmacy.regionId}`;
    const entry = nameCounts.get(key) ?? {
      count: 0,
      label: `${pharmacy.name} (${pharmacy.region.name})`,
    };
    entry.count += 1;
    nameCounts.set(key, entry);
  }
  const duplicates = Array.from(nameCounts.values()).filter((e) => e.count > 1);
  if (duplicates.length > 0) {
    pushItem(
      report,
      "WARNING",
      "Aynı bölgede aynı ada sahip eczaneler var; geçmiş nöbet aktarımında eşleştirme sorunlarına yol açabilir.",
      duplicates.map((d) => `${d.label} — ${d.count} kayıt`)
    );
  }

  // 8. Tarihi bozuk mazeretler
  const brokenUnavailabilities = invalidUnavailabilities.filter(
    (u) => u.endDate.getTime() < u.startDate.getTime()
  );
  if (brokenUnavailabilities.length > 0) {
    pushItem(
      report,
      "CRITICAL",
      `${brokenUnavailabilities.length} mazeret kaydında bitiş tarihi başlangıçtan önce.`,
      brokenUnavailabilities.map(
        (u) =>
          `${u.pharmacy.name}: ${u.startDate.toLocaleDateString("tr-TR")} – ${u.endDate.toLocaleDateString("tr-TR")}`
      )
    );
  }

  // 9. Yinelenen tatil günleri (tarih + tür)
  const holidayKeys = new Map<string, number>();
  for (const holiday of holidays) {
    const key = `${holiday.date.toISOString().slice(0, 10)}|${holiday.type}`;
    holidayKeys.set(key, (holidayKeys.get(key) ?? 0) + 1);
  }
  const duplicateHolidays = Array.from(holidayKeys.entries()).filter(
    ([, count]) => count > 1
  );
  if (duplicateHolidays.length > 0) {
    pushItem(
      report,
      "WARNING",
      "Aynı tarih ve türde birden fazla tatil günü kaydı var.",
      duplicateHolidays.map(([key]) => key.replace("|", " — "))
    );
  }

  // 10. Yayınlanmış çizelge özeti (geçen ay / bu ay / gelecek ay)
  const monthsToCheck = [
    { month: prevMonth, year: prevYear, label: "Geçen ay" },
    { month: currentMonth, year: currentYear, label: "Bu ay" },
    { month: nextMonth, year: nextYear, label: "Gelecek ay" },
  ];
  const scheduleSummary = monthsToCheck.map(({ month, year, label }) => {
    const published = publishedSchedules.filter(
      (s) => s.month === month && s.year === year
    );
    return `${label} (${getTurkishMonthName(month)} ${year}): ${
      published.length > 0
        ? `${published.length} yayında çizelge (${published.map((s) => s.region.name).join(", ")})`
        : "yayında çizelge yok"
    }`;
  });
  const currentPublished = publishedSchedules.some(
    (s) => s.month === currentMonth && s.year === currentYear
  );
  pushItem(
    report,
    currentPublished ? "INFO" : "WARNING",
    currentPublished
      ? "Yayınlanmış çizelge durumu."
      : "Bu ay için yayında çizelge yok; vatandaş ekranı boş görünebilir.",
    scheduleSummary
  );

  // 11. Yaklaşan döneme denk gelen bekleyen talepler
  if (pendingRequestCount > 0) {
    pushItem(
      report,
      "WARNING",
      `${pendingRequestCount} bekleyen nöbet talebi yaklaşan dönemlere denk geliyor. Çizelge oluşturmadan önce incelemeniz önerilir.`
    );
  }

  // 12. Eşleşmeyen geçmiş nöbet kayıtları
  if (unmatchedHistoricalCount > 0) {
    pushItem(
      report,
      "WARNING",
      `${unmatchedHistoricalCount} geçmiş nöbet kaydı hiçbir eczaneyle eşleşmedi ve denge skoruna katılmıyor.`,
      ["Geçmiş Nöbetler sayfasından kayıtları kontrol edebilirsiniz."]
    );
  }

  return report;
}
