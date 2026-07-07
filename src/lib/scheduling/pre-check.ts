import { prisma } from "@/lib/prisma";
import { dateAtUtcMidnight, daysInMonth } from "./date-tr";

// Çizelge oluşturma ön kontrolü: kritik hatalar oluşturmayı engeller,
// uyarılar bilgilendirme amaçlıdır.
export type ScheduleGenerationPreCheck = {
  critical: string[];
  warnings: string[];
};

export async function runScheduleGenerationPreCheck(
  regionId: string,
  month: number,
  year: number
): Promise<ScheduleGenerationPreCheck> {
  const critical: string[] = [];
  const warnings: string[] = [];

  const region = await prisma.region.findUnique({
    where: { id: regionId },
    select: {
      dailyDutyCount: true,
      dutyRule: { select: { id: true } },
      pharmacies: {
        where: { isActive: true },
        select: { id: true, phone: true, address: true, mapUrl: true },
      },
    },
  });
  if (!region) {
    return { critical: ["Seçilen bölge bulunamadı."], warnings: [] };
  }

  if (!region.dutyRule) {
    critical.push("Bu bölgede nöbet kuralı tanımlanmamış.");
  }
  if (region.pharmacies.length < region.dailyDutyCount) {
    critical.push("Aktif eczane sayısı günlük nöbetçi ihtiyacından az.");
  }

  const monthStart = dateAtUtcMidnight(year, month, 1);
  const totalDays = daysInMonth(year, month);
  const monthEnd = dateAtUtcMidnight(year, month, totalDays);
  const pharmacyIds = region.pharmacies.map((p) => p.id);

  const [unavailabilities, approvedBlocks, pendingCount, historicalCount, holidayCount] =
    await Promise.all([
      prisma.unavailability.findMany({
        where: {
          pharmacyId: { in: pharmacyIds },
          startDate: { lte: monthEnd },
          endDate: { gte: monthStart },
        },
        select: { pharmacyId: true, startDate: true, endDate: true },
      }),
      prisma.dutyRequest.findMany({
        where: {
          pharmacyId: { in: pharmacyIds },
          status: "APPROVED",
          requestType: { in: ["CANNOT_DUTY", "EMERGENCY_EXCUSE"] },
          startDate: { lte: monthEnd },
          endDate: { gte: monthStart },
        },
        select: { pharmacyId: true, startDate: true, endDate: true },
      }),
      prisma.dutyRequest.count({
        where: {
          regionId,
          status: "PENDING",
          startDate: { lte: monthEnd },
          endDate: { gte: monthStart },
        },
      }),
      prisma.historicalDutyRecord.count({
        where: { matchStatus: "MATCHED", pharmacy: { regionId } },
      }),
      prisma.holiday.count({
        where: { date: { gte: monthStart, lte: monthEnd } },
      }),
    ]);

  // Gün bazında uygun eczane sayısı: mazeretler + onaylı engelleyici talepler.
  const blocks = [...unavailabilities, ...approvedBlocks];
  let impossibleDays = 0;
  let tightDays = 0;
  for (let day = 1; day <= totalDays; day++) {
    const date = dateAtUtcMidnight(year, month, day);
    const availableCount = region.pharmacies.filter(
      (pharmacy) =>
        !blocks.some(
          (block) =>
            block.pharmacyId === pharmacy.id &&
            block.startDate.getTime() <= date.getTime() &&
            block.endDate.getTime() >= date.getTime()
        )
    ).length;
    if (availableCount < region.dailyDutyCount) {
      impossibleDays += 1;
    } else if (availableCount < region.dailyDutyCount * 2) {
      tightDays += 1;
    }
  }
  if (impossibleDays > 0) {
    critical.push(
      `Mazeretler ve onaylı nöbet tutamama talepleri nedeniyle ${impossibleDays} tarihte yeterli eczane kalmıyor. Çizelge oluşturmadan önce talepleri/mazeretleri gözden geçirin.`
    );
  } else if (tightDays > 0) {
    warnings.push("Bu ay bazı tarihlerde uygun eczane sayısı yetersiz olabilir.");
  }

  if (pendingCount > 0) {
    warnings.push(
      `Bekleyen nöbet talepleri var (${pendingCount} adet). Çizelge oluşturmadan önce incelemeniz önerilir.`
    );
  }
  if (historicalCount === 0) {
    warnings.push(
      "Bu bölge için geçmiş nöbet kaydı bulunmuyor; denge skoru sıfırdan başlayacak."
    );
  }
  if (holidayCount === 0) {
    warnings.push(
      "Bu ay için tanımlı tatil günü bulunmuyor; tatil ağırlıkları uygulanmayacak."
    );
  }

  const missingPhone = region.pharmacies.filter((p) => !p.phone.trim()).length;
  const missingAddress = region.pharmacies.filter((p) => !p.address.trim()).length;
  if (missingPhone > 0 || missingAddress > 0) {
    warnings.push(
      `Bazı eczanelerin iletişim bilgileri eksik (${missingPhone} telefon, ${missingAddress} adres).`
    );
  }

  return { critical, warnings };
}
