import { prisma } from "@/lib/prisma";
import { dateAtUtcMidnight, daysInMonth } from "./date-tr";
import { generateDutySchedule } from "./generate-duty-schedule";

export type GenerateAndSaveDutyScheduleInput = {
  month: number;
  year: number;
  regionId: string;
};

export class DutyScheduleGenerationError extends Error {}

export async function generateAndSaveDutySchedule({
  month,
  year,
  regionId,
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

  const [holidays, unavailabilities, historicalAssignments] = await Promise.all([
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

    return created;
  });

  return schedule;
}
