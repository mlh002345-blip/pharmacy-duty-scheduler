import { prisma } from "@/lib/prisma";
import { isWeekend } from "@/lib/scheduling/date-tr";

// Eczane başına nöbet dengesi özeti:
//   Toplam Denge Skoru = geçmiş nöbet puanı (eşleşen kayıtlar)
//                      + manuel denge düzeltmeleri
//                      + yeni sistemde üretilen nöbetlerin puanı
// Geçmiş kayıtlar hiçbir zaman DutyAssignment'a dönüşmez; sadece skora katılır.

export type PharmacyBalanceRow = {
  pharmacyId: string;
  pharmacyName: string;
  regionName: string;
  isActive: boolean;
  historicalCount: number;
  historicalPoints: number;
  historicalWeekendCount: number;
  historicalHolidayCount: number;
  adjustmentPoints: number;
  generatedCount: number;
  generatedPoints: number;
  totalBalance: number;
};

export async function getDutyBalanceRows(options?: {
  regionId?: string;
}): Promise<PharmacyBalanceRow[]> {
  const pharmacyWhere = options?.regionId ? { regionId: options.regionId } : {};

  const [pharmacies, historicalRecords, adjustmentGroups, generatedGroups] =
    await Promise.all([
      prisma.pharmacy.findMany({
        where: pharmacyWhere,
        select: {
          id: true,
          name: true,
          isActive: true,
          region: { select: { name: true } },
        },
        orderBy: { name: "asc" },
      }),
      prisma.historicalDutyRecord.findMany({
        where: {
          matchStatus: "MATCHED",
          pharmacyId: { not: null },
          ...(options?.regionId ? { pharmacy: { regionId: options.regionId } } : {}),
        },
        select: { pharmacyId: true, dutyDate: true, weight: true, dutyType: true },
      }),
      prisma.dutyBalanceAdjustment.groupBy({
        by: ["pharmacyId"],
        where: options?.regionId ? { pharmacy: { regionId: options.regionId } } : {},
        _sum: { points: true },
      }),
      prisma.dutyAssignment.groupBy({
        by: ["pharmacyId"],
        where: options?.regionId ? { pharmacy: { regionId: options.regionId } } : {},
        _sum: { weight: true },
        _count: { _all: true },
      }),
    ]);

  const adjustmentByPharmacy = new Map(
    adjustmentGroups.map((g) => [g.pharmacyId, g._sum.points ?? 0])
  );
  const generatedByPharmacy = new Map(
    generatedGroups.map((g) => [
      g.pharmacyId,
      { points: g._sum.weight ?? 0, count: g._count._all },
    ])
  );

  const historicalByPharmacy = new Map<
    string,
    { count: number; points: number; weekend: number; holiday: number }
  >();
  for (const record of historicalRecords) {
    if (!record.pharmacyId) continue;
    const entry =
      historicalByPharmacy.get(record.pharmacyId) ??
      { count: 0, points: 0, weekend: 0, holiday: 0 };
    entry.count += 1;
    entry.points += record.weight;
    if (isWeekend(record.dutyDate)) entry.weekend += 1;
    // Tatil/bayram bilgisini içe aktarma sırasında hesaplanan ağırlıktan
    // türetiyoruz: 1.5 ve üzeri ağırlık tatil/bayram nöbetidir.
    if (record.weight >= 1.5) entry.holiday += 1;
    historicalByPharmacy.set(record.pharmacyId, entry);
  }

  return pharmacies.map((pharmacy) => {
    const historical = historicalByPharmacy.get(pharmacy.id);
    const generated = generatedByPharmacy.get(pharmacy.id);
    const adjustmentPoints = adjustmentByPharmacy.get(pharmacy.id) ?? 0;
    const historicalPoints = historical?.points ?? 0;
    const generatedPoints = generated?.points ?? 0;

    return {
      pharmacyId: pharmacy.id,
      pharmacyName: pharmacy.name,
      regionName: pharmacy.region.name,
      isActive: pharmacy.isActive,
      historicalCount: historical?.count ?? 0,
      historicalPoints,
      historicalWeekendCount: historical?.weekend ?? 0,
      historicalHolidayCount: historical?.holiday ?? 0,
      adjustmentPoints,
      generatedCount: generated?.count ?? 0,
      generatedPoints,
      totalBalance: historicalPoints + adjustmentPoints + generatedPoints,
    };
  });
}

// Çizelge oluşturma için: bölgedeki eczanelerin başlangıç denge yükü
// (geçmiş nöbet puanı + manuel düzeltmeler). Yeni sistem atamaları
// algoritmaya ayrıca tarihli kayıt olarak verilir.
export async function getOpeningBalanceByPharmacy(
  regionId: string
): Promise<Map<string, number>> {
  const [historicalGroups, adjustmentGroups] = await Promise.all([
    prisma.historicalDutyRecord.groupBy({
      by: ["pharmacyId"],
      where: {
        matchStatus: "MATCHED",
        pharmacyId: { not: null },
        pharmacy: { regionId },
      },
      _sum: { weight: true },
    }),
    prisma.dutyBalanceAdjustment.groupBy({
      by: ["pharmacyId"],
      where: { pharmacy: { regionId } },
      _sum: { points: true },
    }),
  ]);

  const balance = new Map<string, number>();
  for (const group of historicalGroups) {
    if (!group.pharmacyId) continue;
    balance.set(group.pharmacyId, group._sum.weight ?? 0);
  }
  for (const group of adjustmentGroups) {
    balance.set(
      group.pharmacyId,
      (balance.get(group.pharmacyId) ?? 0) + (group._sum.points ?? 0)
    );
  }
  return balance;
}
