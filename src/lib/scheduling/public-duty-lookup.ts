import { prisma } from "@/lib/prisma";

export async function getPublishedAssignmentsForDate(regionId: string, date: Date) {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth() + 1;

  const schedule = await prisma.dutySchedule.findUnique({
    where: { year_month_regionId: { year, month, regionId } },
  });
  if (!schedule || schedule.status !== "PUBLISHED") return [];

  return prisma.dutyAssignment.findMany({
    where: { dutyScheduleId: schedule.id, date },
    include: { pharmacy: true },
    orderBy: { pharmacy: { name: "asc" } },
  });
}

export type PublishedAssignment = Awaited<
  ReturnType<typeof getPublishedAssignmentsForDate>
>[number];
