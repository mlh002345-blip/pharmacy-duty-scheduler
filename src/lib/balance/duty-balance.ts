import { prisma } from "@/lib/prisma";

// Eczane başına nöbet dengesi özeti:
//   Toplam Denge Skoru = geçmiş nöbet puanı (eşleşen kayıtlar)
//                      + manuel denge düzeltmeleri
//                      + yeni sistemde üretilen nöbetlerin puanı
// Geçmiş kayıtlar hiçbir zaman DutyAssignment'a dönüşmez; sadece skora katılır.

type HistoricalGroupRow = {
  pharmacyId: string;
  count: bigint;
  points: number | null;
  weekend: bigint;
  holiday: bigint;
};

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

  // Aggregated in the database (GROUP BY pharmacyId) rather than fetched
  // row-by-row and reduced in JS: at pilot scale, HistoricalDutyRecord can
  // hold hundreds of thousands of rows, and this report has no pagination
  // (it's a full roster summary), so an unbounded findMany here was
  // measured to dominate page load time (see
  // docs/security/23-large-data-query-plan-validation.md). The weekday
  // check (Saturday/Sunday via EXTRACT(DOW ...)) matches the app's
  // existing UTC-only date model (dutyDate is always stored as a
  // UTC-midnight `timestamp without time zone`, see
  // src/lib/scheduling/date-tr.ts's dateAtUtcMidnight), so no timezone
  // conversion happens on either side of the comparison.
  const [pharmacies, historicalGrouped, adjustmentGroups, generatedGroups] =
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
      options?.regionId
        ? prisma.$queryRaw<HistoricalGroupRow[]>`
            SELECT "pharmacyId",
                   count(*) AS count,
                   sum("weight") AS points,
                   sum(CASE WHEN EXTRACT(DOW FROM "dutyDate") IN (0, 6) THEN 1 ELSE 0 END) AS weekend,
                   sum(CASE WHEN "weight" >= 1.5 THEN 1 ELSE 0 END) AS holiday
            FROM "HistoricalDutyRecord"
            WHERE "matchStatus" = 'MATCHED' AND "pharmacyId" IS NOT NULL
              AND "pharmacyId" IN (SELECT "id" FROM "Pharmacy" WHERE "regionId" = ${options.regionId})
            GROUP BY "pharmacyId"
          `
        : prisma.$queryRaw<HistoricalGroupRow[]>`
            SELECT "pharmacyId",
                   count(*) AS count,
                   sum("weight") AS points,
                   sum(CASE WHEN EXTRACT(DOW FROM "dutyDate") IN (0, 6) THEN 1 ELSE 0 END) AS weekend,
                   sum(CASE WHEN "weight" >= 1.5 THEN 1 ELSE 0 END) AS holiday
            FROM "HistoricalDutyRecord"
            WHERE "matchStatus" = 'MATCHED' AND "pharmacyId" IS NOT NULL
            GROUP BY "pharmacyId"
          `,
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

  const historicalByPharmacy = new Map(
    historicalGrouped.map((row) => [
      row.pharmacyId,
      {
        count: Number(row.count),
        points: row.points ?? 0,
        weekend: Number(row.weekend),
        holiday: Number(row.holiday),
      },
    ])
  );

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
