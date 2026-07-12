import { afterEach, describe, expect, it } from "vitest";

import { prisma } from "@/lib/prisma";
import { editDutyAssignmentAction } from "@/app/(dashboard)/cizelgeler/[id]/atama/assignment-actions";
import { IntegrationRedirectSignal, setIntegrationTestSessionToken } from "./helpers/setup";
import { raceThroughGate } from "./helpers/gate";
import {
  createTestDutyRule,
  createTestPharmacy,
  createTestRegion,
  createTestSessionToken,
  createTestUser,
  cleanupTrackedIds,
  newTrackedIds,
} from "./helpers/fixtures";

describe("concurrent DutyAssignment uniqueness (real Postgres @@unique([dutyScheduleId, pharmacyId, date]))", () => {
  const tracked = newTrackedIds();

  afterEach(async () => {
    setIntegrationTestSessionToken(undefined);
    await cleanupTrackedIds(tracked);
  });

  it("lets only one of two concurrent edits land the same pharmacy on the same date", async () => {
    const region = await createTestRegion(tracked);
    await createTestDutyRule(region.id);
    const pharmacyA = await createTestPharmacy(tracked, region.id);
    const pharmacyB = await createTestPharmacy(tracked, region.id);
    const targetPharmacy = await createTestPharmacy(tracked, region.id);
    const admin = await createTestUser(tracked, {
      role: "ADMIN",
      organizationId: region.organizationId,
    });
    const token = await createTestSessionToken(admin.id);
    setIntegrationTestSessionToken(token);

    const targetDate = new Date(Date.UTC(2027, 10, 15));

    const schedule = await prisma.dutySchedule.create({
      data: { month: 11, year: 2027, regionId: region.id, status: "DRAFT" },
    });
    tracked.dutyScheduleIds.push(schedule.id);

    const assignmentA = await prisma.dutyAssignment.create({
      data: { dutyScheduleId: schedule.id, date: targetDate, pharmacyId: pharmacyA.id, weight: 1 },
    });
    const assignmentB = await prisma.dutyAssignment.create({
      data: {
        dutyScheduleId: schedule.id,
        date: targetDate,
        pharmacyId: pharmacyB.id,
        weight: 1,
      },
    });

    function editFormData(): FormData {
      const fd = new FormData();
      fd.set("pharmacyId", targetPharmacy.id);
      fd.set("reason", "Eşzamanlı test düzenlemesi");
      fd.set("confirmOverride", "true");
      return fd;
    }

    async function runEdit(assignmentId: string) {
      try {
        const result = await editDutyAssignmentAction(
          assignmentId,
          { success: false, message: "" },
          editFormData()
        );
        return { redirected: false as const, result };
      } catch (error) {
        if (error instanceof IntegrationRedirectSignal) {
          return { redirected: true as const, result: null };
        }
        throw error;
      }
    }

    const [r1, r2] = await raceThroughGate(
      () => runEdit(assignmentA.id),
      () => runEdit(assignmentB.id)
    );

    expect(r1.status).toBe("fulfilled");
    expect(r2.status).toBe("fulfilled");
    const outcomes = [
      r1.status === "fulfilled" ? r1.value : null,
      r2.status === "fulfilled" ? r2.value : null,
    ];

    const winners = outcomes.filter((o) => o !== null && o.redirected).length;
    // The loser can be rejected via either of two legitimate paths,
    // depending on how the real race resolves: the DB-level P2002 unique-
    // constraint mapping (its in-memory snapshot was stale, its own write
    // hit the DB constraint), or the in-memory isAlreadyAssignedOnDate
    // check (its snapshot happened to already reflect the winner's
    // committed write by the time it ran). Both are the same underlying
    // invariant — the second concurrent request never creates a
    // duplicate — so either message counts as "loser correctly rejected".
    const loserMessages = [
      "Bu eczane aynı tarihte bu çizelgede zaten nöbetçi olarak atanmış.",
      "Seçilen eczane bu tarihte zaten atanmış.",
    ];
    const losers = outcomes.filter(
      (o) =>
        o !== null && !o.redirected && loserMessages.includes(o.result?.errors?.pharmacyId?.[0] ?? "")
    ).length;
    expect(winners).toBe(1);
    expect(losers).toBe(1);

    const assignmentsOnDate = await prisma.dutyAssignment.findMany({
      where: { dutyScheduleId: schedule.id, date: targetDate },
    });
    const occupyingTarget = assignmentsOnDate.filter((a) => a.pharmacyId === targetPharmacy.id);
    expect(occupyingTarget).toHaveLength(1);

    // The schedule remains internally consistent: still exactly two
    // assignments on that date total (one moved to targetPharmacy, the
    // other unchanged from its pre-race pharmacy), no duplicates, no rows
    // lost.
    expect(assignmentsOnDate).toHaveLength(2);
    const pharmacyIds = assignmentsOnDate.map((a) => a.pharmacyId).sort();
    expect(pharmacyIds).toContain(targetPharmacy.id);

    const auditLogs = await prisma.auditLog.findMany({
      where: { entity: "DutyAssignment", entityId: { in: [assignmentA.id, assignmentB.id] } },
    });
    // Audit logs reflect only committed mutations: exactly one UPDATE was
    // actually committed (the loser's transaction rolled back entirely).
    expect(auditLogs).toHaveLength(1);
  });
});
