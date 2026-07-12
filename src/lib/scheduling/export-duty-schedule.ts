import { prisma } from "@/lib/prisma";
import { toAsciiSlug } from "@/lib/slug";

export async function loadDutyScheduleForExport(scheduleId: string, organizationId: string) {
  return prisma.dutySchedule.findFirst({
    where: { id: scheduleId, region: { organizationId } },
    select: {
      id: true,
      month: true,
      year: true,
      status: true,
      region: { select: { name: true } },
      assignments: {
        select: {
          date: true,
          weight: true,
          isManual: true,
          note: true,
          pharmacy: {
            select: { name: true, pharmacistName: true, phone: true, address: true },
          },
        },
        orderBy: [{ date: "asc" }, { pharmacy: { name: "asc" } }],
      },
    },
  });
}

export type DutyScheduleForExport = NonNullable<
  Awaited<ReturnType<typeof loadDutyScheduleForExport>>
>;

export function buildDutyScheduleExportFilename(
  schedule: { year: number; month: number; region: { name: string } },
  extension: "xlsx" | "pdf"
): string {
  const monthPart = String(schedule.month).padStart(2, "0");
  const regionPart = toAsciiSlug(schedule.region.name) || "bolge";
  return `nobet-cizelgesi-${schedule.year}-${monthPart}-${regionPart}.${extension}`;
}
