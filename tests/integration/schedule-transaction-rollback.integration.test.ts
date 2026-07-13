import { afterEach, describe, expect, it } from "vitest";

import { prisma } from "@/lib/prisma";
import { generateAndSaveDutySchedule } from "@/lib/scheduling/generate-and-save-duty-schedule";
import {
  createTestDutyRule,
  createTestPharmacy,
  createTestRegion,
  createTestUser,
  cleanupTrackedIds,
  newTrackedIds,
} from "./helpers/fixtures";

describe("schedule generation transaction rollback (real Postgres)", () => {
  const tracked = newTrackedIds();

  afterEach(async () => {
    await cleanupTrackedIds(tracked);
  });

  it("leaves no DutySchedule/DutyAssignment/DutyScheduleWarning/AuditLog rows when the audit write fails mid-transaction", async () => {
    const region = await createTestRegion(tracked);
    await createTestDutyRule(region.id);
    await createTestPharmacy(tracked, region.id);
    const admin = await createTestUser(tracked, { role: "ADMIN" });

    const boom = new Error("forced-audit-write-failure-for-rollback-test");

    await expect(
      generateAndSaveDutySchedule({
        month: 8,
        year: 2027,
        regionId: region.id,
        organizationId: region.organizationId,
        userId: admin.id,
        // Test-only seam (see generate-and-save-duty-schedule.ts): runs
        // inside the real transaction, using the real tx client, but
        // throws instead of writing — proving the transaction rolls back
        // everything written before it, not just skipping the audit row.
        writeAuditLogFn: async () => {
          throw boom;
        },
      })
    ).rejects.toThrow(boom);

    const schedules = await prisma.dutySchedule.findMany({
      where: { regionId: region.id, year: 2027, month: 8 },
    });
    expect(schedules).toHaveLength(0);

    const assignments = await prisma.dutyAssignment.findMany({
      where: { dutySchedule: { regionId: region.id, year: 2027, month: 8 } },
    });
    expect(assignments).toHaveLength(0);

    const warnings = await prisma.dutyScheduleWarning.findMany({
      where: { schedule: { regionId: region.id, year: 2027, month: 8 } },
    });
    expect(warnings).toHaveLength(0);

    const auditLogs = await prisma.auditLog.findMany({
      where: { entity: "DutySchedule" },
    });
    expect(auditLogs).toHaveLength(0);
  });

  it("commits DutySchedule/DutyAssignment/AuditLog rows together when the audit write succeeds (control case)", async () => {
    const region = await createTestRegion(tracked);
    await createTestDutyRule(region.id);
    await createTestPharmacy(tracked, region.id);
    const admin = await createTestUser(tracked, { role: "ADMIN" });

    const { schedule } = await generateAndSaveDutySchedule({
      month: 9,
      year: 2027,
      regionId: region.id,
      organizationId: region.organizationId,
      userId: admin.id,
    });
    tracked.dutyScheduleIds.push(schedule.id);

    const persisted = await prisma.dutySchedule.findUnique({ where: { id: schedule.id } });
    expect(persisted).not.toBeNull();

    const auditLogs = await prisma.auditLog.findMany({
      where: { entity: "DutySchedule", entityId: schedule.id },
    });
    expect(auditLogs).toHaveLength(1);
  });
});
