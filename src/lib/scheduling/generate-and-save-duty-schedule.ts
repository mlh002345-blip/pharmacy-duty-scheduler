import type { Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { getOpeningBalanceByPharmacy } from "@/lib/balance/duty-balance";
import { writeAuditLog } from "@/lib/audit";
import { dateAtUtcMidnight, daysInMonth } from "./date-tr";
import { generateDutySchedule } from "./generate-duty-schedule";

export type GenerateAndSaveDutyScheduleInput = {
  month: number;
  year: number;
  regionId: string;
  // Oluşturma işlemini başlatan kullanıcı: denetim kaydı, çizelge/atama/uyarı
  // yazımlarıyla aynı veritabanı işlemi (transaction) içinde yazılır ki
  // denetim kaydı başarısız olursa taslak çizelge de geri alınsın.
  userId: string;
  // Test-only seam: allows integration tests to force a failure inside the
  // transaction (after the DutySchedule row is created) to prove the
  // rollback boundary, without weakening or bypassing it. Production code
  // never passes this — the default is the real writeAuditLog, so
  // production behavior is unchanged.
  writeAuditLogFn?: typeof writeAuditLog;
};

export class DutyScheduleGenerationError extends Error {}

export async function generateAndSaveDutySchedule({
  month,
  year,
  regionId,
  userId,
  writeAuditLogFn = writeAuditLog,
}: GenerateAndSaveDutyScheduleInput) {
  const region = await prisma.region.findUnique({
    where: { id: regionId },
    include: { dutyRule: true },
  });
  if (!region) {
    throw new DutyScheduleGenerationError("Bölge bulunamadı.");
  }
  if (!region.dutyRule) {
    throw new DutyScheduleGenerationError(
      "Bu bölge için tanımlı bir nöbet kuralı bulunamadı."
    );
  }

  const pharmacies = await prisma.pharmacy.findMany({
    where: { regionId },
  });
  if (!pharmacies.some((p) => p.isActive)) {
    throw new DutyScheduleGenerationError(
      "Bu bölgede aktif eczane bulunamadığı için çizelge oluşturulamaz."
    );
  }

  const monthStart = dateAtUtcMidnight(year, month, 1);
  const monthEnd = dateAtUtcMidnight(year, month, daysInMonth(year, month));

  const pharmacyIds = pharmacies.map((p) => p.id);

  const [holidays, unavailabilities, historicalAssignments, openingBalance, dutyRequests] =
    await Promise.all([
      prisma.holiday.findMany({
        where: { date: { gte: monthStart, lte: monthEnd } },
      }),
      prisma.unavailability.findMany({
        where: {
          pharmacyId: { in: pharmacyIds },
          startDate: { lte: monthEnd },
          endDate: { gte: monthStart },
        },
      }),
      prisma.dutyAssignment.findMany({
        where: {
          pharmacyId: { in: pharmacyIds },
          date: { lt: monthStart },
        },
        orderBy: { date: "asc" },
      }),
      // Başlangıç nöbet dengesi: içe aktarılan geçmiş nöbet puanları +
      // manuel denge düzeltmeleri.
      getOpeningBalanceByPharmacy(regionId),
      // Yalnızca onaylı nöbet talepleri çizelge oluşturmayı etkiler.
      prisma.dutyRequest.findMany({
        where: {
          pharmacyId: { in: pharmacyIds },
          status: "APPROVED",
          startDate: { lte: monthEnd },
          endDate: { gte: monthStart },
        },
      }),
    ]);

  const result = generateDutySchedule({
    month,
    year,
    regionId,
    dailyDutyCount: region.dailyDutyCount,
    dutyRule: region.dutyRule,
    pharmacies,
    holidays,
    unavailabilities,
    historicalAssignments,
    openingBalance,
    dutyRequests,
  });

  const schedule = await prisma.$transaction(async (tx) => {
    const created = await tx.dutySchedule.create({
      data: { month, year, regionId, status: "DRAFT" },
    });

    if (result.assignments.length > 0) {
      await tx.dutyAssignment.createMany({
        data: result.assignments.map((assignment) => ({
          dutyScheduleId: created.id,
          date: assignment.date,
          pharmacyId: assignment.pharmacyId,
          weight: assignment.weight,
          note: assignment.note,
        })),
      });
    }

    if (result.warnings.length > 0) {
      await tx.dutyScheduleWarning.createMany({
        data: result.warnings.map((warning) => ({
          scheduleId: created.id,
          date: warning.date,
          message: warning.message,
        })),
      });
    }

    await writeAuditLogFn(tx as Prisma.TransactionClient, {
      userId,
      action: "CREATE",
      entity: "DutySchedule",
      entityId: created.id,
      after: { month, year, regionId, status: "DRAFT" },
    });

    return created;
  });

  return { schedule, info: result.info };
}
