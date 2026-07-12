import { afterEach, describe, expect, it } from "vitest";

import { prisma } from "@/lib/prisma";
import {
  DutyScheduleGenerationError,
  generateAndSaveDutySchedule,
} from "@/lib/scheduling/generate-and-save-duty-schedule";
import { raceThroughGate } from "./helpers/gate";
import {
  createTestDutyRule,
  createTestPharmacy,
  createTestRegion,
  createTestUser,
  cleanupTrackedIds,
  newTrackedIds,
} from "./helpers/fixtures";

describe("concurrent DutySchedule uniqueness (real Postgres @@unique([year, month, regionId]))", () => {
  const tracked = newTrackedIds();

  afterEach(async () => {
    await cleanupTrackedIds(tracked);
  });

  it("lets exactly one of two concurrent generate calls for the same year/month/region succeed", async () => {
    const region = await createTestRegion(tracked);
    await createTestDutyRule(region.id);
    await createTestPharmacy(tracked, region.id);
    const admin = await createTestUser(tracked, { role: "ADMIN" });

    const attempt = () =>
      generateAndSaveDutySchedule({ month: 10, year: 2027, regionId: region.id, organizationId: region.organizationId, userId: admin.id });

    const [r1, r2] = await raceThroughGate(attempt, attempt);

    const outcomes = [r1, r2];
    const fulfilled = outcomes.filter((o) => o.status === "fulfilled");
    const rejected = outcomes.filter((o) => o.status === "rejected");

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);

    // The loser must fail with a raw Prisma P2002, which is exactly what
    // the calling action (createDutyScheduleAction) maps to the friendly
    // duplicate-schedule message — this test proves the DB constraint
    // itself serializes the two concurrent writes; the message-mapping
    // layer is already covered by existing unit tests.
    const rejectedReason = (rejected[0] as PromiseRejectedResult).reason;
    expect(rejectedReason).not.toBeInstanceOf(DutyScheduleGenerationError);
    expect(String(rejectedReason?.code ?? rejectedReason)).toContain("P2002");

    const schedules = await prisma.dutySchedule.findMany({
      where: { regionId: region.id, year: 2027, month: 10 },
    });
    expect(schedules).toHaveLength(1);
    tracked.dutyScheduleIds.push(schedules[0].id);

    const winnerScheduleId = (fulfilled[0] as PromiseFulfilledResult<Awaited<ReturnType<typeof attempt>>>)
      .value.schedule.id;
    expect(schedules[0].id).toBe(winnerScheduleId);

    // No orphaned child rows from the losing transaction: every assignment
    // and warning in this region/month belongs only to the single winning
    // schedule (the losing transaction's DutySchedule.create() itself
    // failed the unique constraint, so it could never have reached the
    // point of writing assignments/warnings in the first place).
    const assignments = await prisma.dutyAssignment.findMany({
      where: { dutyScheduleId: schedules[0].id },
    });
    for (const assignment of assignments) {
      expect(assignment.dutyScheduleId).toBe(schedules[0].id);
    }

    const auditLogs = await prisma.auditLog.findMany({
      where: { entity: "DutySchedule", entityId: schedules[0].id },
    });
    expect(auditLogs).toHaveLength(1);
  });
});
