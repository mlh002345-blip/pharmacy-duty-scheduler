import { prisma } from "@/lib/prisma";
import { toAsciiSlug } from "@/lib/slug";

export async function loadDutyScheduleForExport(scheduleId: string) {
  return prisma.dutySchedule.findUnique({
    where: { id: scheduleId },
    include: {
      region: true,
      assignments: {
        include: { pharmacy: true },
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
