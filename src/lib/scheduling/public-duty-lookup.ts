import { cache } from "react";

import { prisma } from "@/lib/prisma";

// Today/tomorrow (and an optional custom date) are usually in the same
// month, so without this the citizen page would look up the same published
// schedule 2-3 times per request. `cache()` memoizes per render/request.
const getPublishedScheduleForMonth = cache(
  async (regionId: string, year: number, month: number) => {
    return prisma.dutySchedule.findUnique({
      where: { year_month_regionId: { year, month, regionId } },
      select: { id: true, status: true },
    });
  }
);

export async function getPublishedAssignmentsForDate(regionId: string, date: Date) {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth() + 1;

  const schedule = await getPublishedScheduleForMonth(regionId, year, month);
  if (!schedule || schedule.status !== "PUBLISHED") return [];

  return prisma.dutyAssignment.findMany({
    where: { dutyScheduleId: schedule.id, date },
    select: {
      id: true,
      pharmacy: { select: { name: true, phone: true, address: true, mapUrl: true } },
    },
    orderBy: { pharmacy: { name: "asc" } },
  });
}

export type PublishedAssignment = Awaited<
  ReturnType<typeof getPublishedAssignmentsForDate>
>[number];
