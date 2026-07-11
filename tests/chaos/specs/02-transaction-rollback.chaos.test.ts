import { afterAll, describe, expect, it } from "vitest";
import type { Prisma } from "@prisma/client";

import { generateAndSaveDutySchedule } from "@/lib/scheduling/generate-and-save-duty-schedule";
import { writeAuditLog } from "@/lib/audit";

import { terminateBackendPid } from "../../../scripts/chaos/fault-control";
import { createChaosPharmacy, createChaosRegion, createChaosUser } from "../helpers/fixtures";
import { chaosPrisma } from "../helpers/db";

// Scenario B — DB disconnect during a multi-write transaction (Step 6,
// item 5). Exercises the REAL production transaction path
// (generateAndSaveDutySchedule, the same function createDutyScheduleAction
// calls) and forces a REAL PostgreSQL backend termination — not a mocked
// Prisma rejection — at a precise, deterministic point: after the
// DutySchedule + DutyAssignment rows have been written inside the
// transaction, but before it commits. This uses the writeAuditLogFn
// parameter, an existing, documented test-only seam in
// generate-and-save-duty-schedule.ts ("allows integration tests to force
// a failure inside the transaction ... to prove the rollback boundary,
// without weakening or bypassing it") — production code never passes it.
describe("scenario B: DB disconnect mid multi-write transaction", () => {
  afterAll(async () => {
    await chaosPrisma.$disconnect();
  });

  it("real PostgreSQL rolls back every write when the connection is killed before commit", async () => {
    const user = await createChaosUser({ role: "ADMIN" });
    const region = await createChaosRegion({ dailyDutyCount: 1 });
    await chaosPrisma.dutyRule.create({
      data: {
        regionId: region.id,
        minDaysBetweenDuties: 1,
        weekdayWeight: 1,
        saturdayWeight: 1.25,
        sundayWeight: 1.5,
        officialHolidayWeight: 2,
        religiousHolidayWeight: 2,
      },
    });
    await createChaosPharmacy(region.id);
    await createChaosPharmacy(region.id);

    const YEAR = 2032; // far-future, collision-free with any real schedule
    const MONTH = 3;

    let capturedPid: number | null = null;
    let terminated = false;

    const killMidTransaction: typeof writeAuditLog = async (client, params) => {
      // At this point (called from inside generate-and-save-duty-schedule's
      // $transaction callback) the DutySchedule row and its DutyAssignment
      // rows have already been written on this exact connection, but
      // nothing has committed yet.
      const pidRows = await (client as Prisma.TransactionClient).$queryRaw<{ pid: number }[]>`
        SELECT pg_backend_pid() AS pid
      `;
      capturedPid = pidRows[0].pid;
      terminated = await terminateBackendPid(capturedPid);
      // The connection is now dead. Attempting the real audit-log write
      // (still on the same, now-severed connection) surfaces the actual
      // PostgreSQL disconnect error, exactly as a real mid-flight outage
      // would — this is not a mocked rejection.
      await writeAuditLog(client, params);
    };

    let thrown: unknown;
    try {
      await generateAndSaveDutySchedule({
        month: MONTH,
        year: YEAR,
        regionId: region.id,
        userId: user.id,
        writeAuditLogFn: killMidTransaction,
      });
    } catch (error) {
      thrown = error;
    }

    // The caller must receive a failure, never success.
    expect(thrown).toBeDefined();
    expect(terminated).toBe(true);
    expect(capturedPid).not.toBeNull();

    // Real PostgreSQL rollback evidence — every row the transaction wrote
    // must be gone, not partially committed.
    const schedules = await chaosPrisma.dutySchedule.findMany({ where: { regionId: region.id, year: YEAR, month: MONTH } });
    expect(schedules).toHaveLength(0);

    const assignments = await chaosPrisma.dutyAssignment.findMany({ where: { dutySchedule: { regionId: region.id, year: YEAR, month: MONTH } } });
    expect(assignments).toHaveLength(0);

    const warnings = await chaosPrisma.dutyScheduleWarning.findMany({ where: { schedule: { regionId: region.id, year: YEAR, month: MONTH } } });
    expect(warnings).toHaveLength(0);

    const auditLogs = await chaosPrisma.auditLog.findMany({ where: { entity: "DutySchedule", userId: user.id } });
    expect(auditLogs).toHaveLength(0);
  }, 30_000);
});
