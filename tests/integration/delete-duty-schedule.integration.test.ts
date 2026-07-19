// Verifies deleteDutyScheduleAction against real Postgres — in particular
// that a DRAFT schedule with an AuditLog row referencing one of its
// DutyAssignments (written by the manual-edit flow, both V1 and V2) can
// still be deleted: AuditLog.dutyAssignmentId is ON DELETE SET NULL, not
// a blocking FK, so the assignment delete must never fail with a P2003.
// Also proves a V2-generated schedule (with its DutyGenerationRun) is
// deleted cleanly via the Cascade on DutyGenerationRun.dutyScheduleId,
// and that a PUBLISHED schedule is refused regardless of these details.

import { afterEach, describe, expect, it } from "vitest";

import { prisma } from "@/lib/prisma";
import { deleteDutyScheduleAction } from "@/app/(dashboard)/cizelgeler/actions";
import { editDutyAssignmentAction } from "@/app/(dashboard)/cizelgeler/[id]/atama/assignment-actions";
import { IntegrationRedirectSignal, setIntegrationTestSessionToken } from "./helpers/setup";
import {
  createTestDutyRule,
  createTestPharmacy,
  createTestRegion,
  createTestSessionToken,
  createTestUser,
  cleanupTrackedIds,
  newTrackedIds,
} from "./helpers/fixtures";

describe("deleteDutyScheduleAction (real Postgres)", () => {
  const tracked = newTrackedIds();

  afterEach(async () => {
    setIntegrationTestSessionToken(undefined);
    await cleanupTrackedIds(tracked);
  });

  it("deletes a DRAFT V1 schedule even after a manual edit wrote an AuditLog referencing the assignment", async () => {
    const region = await createTestRegion(tracked);
    await createTestDutyRule(region.id);
    const pharmacyA = await createTestPharmacy(tracked, region.id);
    const pharmacyB = await createTestPharmacy(tracked, region.id);
    const admin = await createTestUser(tracked, { role: "ADMIN", organizationId: region.organizationId });
    const token = await createTestSessionToken(admin.id);
    setIntegrationTestSessionToken(token);

    const schedule = await prisma.dutySchedule.create({
      data: { month: 5, year: 2028, regionId: region.id, status: "DRAFT" },
    });
    tracked.dutyScheduleIds.push(schedule.id);
    const assignment = await prisma.dutyAssignment.create({
      data: {
        dutyScheduleId: schedule.id,
        date: new Date(Date.UTC(2028, 4, 10)),
        pharmacyId: pharmacyA.id,
        weight: 1,
      },
    });

    // Manual edit — writes an AuditLog row with dutyAssignmentId set to
    // this exact assignment, reproducing the real state a chamber staff
    // member's correction leaves behind before anyone tries to delete
    // the draft. Succeeds by redirecting, same as deleteDutyScheduleAction.
    await expect(
      editDutyAssignmentAction(
        assignment.id,
        { success: false, message: "" },
        (() => {
          const fd = new FormData();
          fd.set("pharmacyId", pharmacyB.id);
          fd.set("reason", "test düzeltmesi");
          return fd;
        })()
      )
    ).rejects.toThrow(IntegrationRedirectSignal);
    const auditRow = await prisma.auditLog.findFirst({ where: { dutyAssignmentId: assignment.id } });
    expect(auditRow).not.toBeNull();

    await expect(deleteDutyScheduleAction(schedule.id)).rejects.toThrow(IntegrationRedirectSignal);

    const remainingSchedule = await prisma.dutySchedule.findUnique({ where: { id: schedule.id } });
    expect(remainingSchedule).toBeNull();
    const remainingAssignment = await prisma.dutyAssignment.findUnique({ where: { id: assignment.id } });
    expect(remainingAssignment).toBeNull();
    // The AuditLog row itself survives (audit trail is never deleted by
    // this action) with its dutyAssignmentId nulled out by the FK's own
    // ON DELETE SET NULL — never blocked, never silently orphaned.
    const survivingAudit = await prisma.auditLog.findUnique({ where: { id: auditRow!.id } });
    expect(survivingAudit?.dutyAssignmentId).toBeNull();
  });

  it("refuses to delete a PUBLISHED schedule", async () => {
    const region = await createTestRegion(tracked);
    const pharmacy = await createTestPharmacy(tracked, region.id);
    const admin = await createTestUser(tracked, { role: "ADMIN", organizationId: region.organizationId });
    const token = await createTestSessionToken(admin.id);
    setIntegrationTestSessionToken(token);

    const schedule = await prisma.dutySchedule.create({
      data: { month: 6, year: 2028, regionId: region.id, status: "PUBLISHED" },
    });
    tracked.dutyScheduleIds.push(schedule.id);
    await prisma.dutyAssignment.create({
      data: {
        dutyScheduleId: schedule.id,
        date: new Date(Date.UTC(2028, 5, 1)),
        pharmacyId: pharmacy.id,
        weight: 1,
      },
    });

    await expect(deleteDutyScheduleAction(schedule.id)).rejects.toThrow(IntegrationRedirectSignal);

    const stillThere = await prisma.dutySchedule.findUnique({ where: { id: schedule.id } });
    expect(stillThere).not.toBeNull();
  });

  it("deletes a V2-generated DRAFT schedule, cascading its DutyGenerationRun", async () => {
    const region = await createTestRegion(tracked);
    const pharmacy = await createTestPharmacy(tracked, region.id);
    const admin = await createTestUser(tracked, { role: "ADMIN", organizationId: region.organizationId });
    const token = await createTestSessionToken(admin.id);
    setIntegrationTestSessionToken(token);

    const plan = await prisma.dutyPlan.create({
      data: { name: "Test Plan", organizationId: region.organizationId, regionId: region.id },
    });
    const planVersion = await prisma.dutyPlanVersion.create({
      data: { planId: plan.id, versionNumber: 1, status: "ACTIVE", validFrom: new Date("2028-07-01T00:00:00.000Z"), activatedAt: new Date() },
    });

    const schedule = await prisma.dutySchedule.create({
      data: { month: 7, year: 2028, regionId: region.id, status: "DRAFT", planVersionId: planVersion.id },
    });
    tracked.dutyScheduleIds.push(schedule.id);

    const generationRun = await prisma.dutyGenerationRun.create({
      data: {
        status: "COMMITTED",
        organizationId: region.organizationId,
        regionId: region.id,
        planId: plan.id,
        planVersionId: planVersion.id,
        dutyScheduleId: schedule.id,
        generationMode: "PREVIEW",
        periodStart: new Date("2028-07-01T00:00:00.000Z"),
        periodEnd: new Date("2028-07-01T00:00:00.000Z"),
        configurationFingerprint: "test-config",
        runtimeInputHash: "test-runtime",
        ruleSetFingerprint: "test-ruleset",
        strategySetFingerprint: "test-strategyset",
        upstreamResultFingerprint: "test-upstream",
        membershipSnapshotHash: "test-membership",
        provisionalSelectionFingerprint: "test-provisional",
        completeDraftFingerprint: `test-fingerprint-${schedule.id}`,
        engineVersion: 1,
        selectionEngineVersion: 1,
        draftEngineVersion: 1,
        manifest: { counts: { totalAssignments: 1 } },
      },
    });
    await prisma.dutyAssignment.create({
      data: {
        dutyScheduleId: schedule.id,
        date: new Date(Date.UTC(2028, 6, 1)),
        pharmacyId: pharmacy.id,
        weight: 1,
        generationRunId: generationRun.id,
      },
    });

    await expect(deleteDutyScheduleAction(schedule.id)).rejects.toThrow(IntegrationRedirectSignal);

    const remainingSchedule = await prisma.dutySchedule.findUnique({ where: { id: schedule.id } });
    expect(remainingSchedule).toBeNull();
    const remainingRun = await prisma.dutyGenerationRun.findUnique({ where: { id: generationRun.id } });
    expect(remainingRun).toBeNull();

    // DutyPlan/DutyPlanVersion aren't part of this file's shared
    // TrackedIds shape (cleanupTrackedIds predates Duty Rules V2) —
    // cleaned up directly here, same pattern as the Duty Rules V2 plan-
    // configuration integration suite.
    await prisma.auditLog.deleteMany({ where: { entity: "DutyPlan", entityId: plan.id } });
    await prisma.dutyPlanVersion.deleteMany({ where: { id: planVersion.id } });
    await prisma.dutyPlan.deleteMany({ where: { id: plan.id } });
  });

  it("deletes an APPROVED V2 schedule (the UI now allows this — only PUBLISHED is refused)", async () => {
    const region = await createTestRegion(tracked);
    const pharmacy = await createTestPharmacy(tracked, region.id);
    const admin = await createTestUser(tracked, { role: "ADMIN", organizationId: region.organizationId });
    const token = await createTestSessionToken(admin.id);
    setIntegrationTestSessionToken(token);

    const plan = await prisma.dutyPlan.create({
      data: { name: "Onaylı Test Planı", organizationId: region.organizationId, regionId: region.id },
    });
    const planVersion = await prisma.dutyPlanVersion.create({
      data: { planId: plan.id, versionNumber: 1, status: "ACTIVE", validFrom: new Date("2028-08-01T00:00:00.000Z"), activatedAt: new Date() },
    });

    const schedule = await prisma.dutySchedule.create({
      data: { month: 8, year: 2028, regionId: region.id, status: "APPROVED", planVersionId: planVersion.id },
    });
    tracked.dutyScheduleIds.push(schedule.id);

    const generationRun = await prisma.dutyGenerationRun.create({
      data: {
        status: "COMMITTED",
        organizationId: region.organizationId,
        regionId: region.id,
        planId: plan.id,
        planVersionId: planVersion.id,
        dutyScheduleId: schedule.id,
        generationMode: "PREVIEW",
        periodStart: new Date("2028-08-01T00:00:00.000Z"),
        periodEnd: new Date("2028-08-01T00:00:00.000Z"),
        configurationFingerprint: "test-config",
        runtimeInputHash: "test-runtime",
        ruleSetFingerprint: "test-ruleset",
        strategySetFingerprint: "test-strategyset",
        upstreamResultFingerprint: "test-upstream",
        membershipSnapshotHash: "test-membership",
        provisionalSelectionFingerprint: "test-provisional",
        completeDraftFingerprint: `test-fingerprint-${schedule.id}`,
        engineVersion: 1,
        selectionEngineVersion: 1,
        draftEngineVersion: 1,
        manifest: { counts: { totalAssignments: 1 } },
        approvedAt: new Date(),
        approvedById: admin.id,
      },
    });
    await prisma.dutyAssignment.create({
      data: {
        dutyScheduleId: schedule.id,
        date: new Date(Date.UTC(2028, 7, 1)),
        pharmacyId: pharmacy.id,
        weight: 1,
        generationRunId: generationRun.id,
      },
    });

    await expect(deleteDutyScheduleAction(schedule.id)).rejects.toThrow(IntegrationRedirectSignal);

    const remainingSchedule = await prisma.dutySchedule.findUnique({ where: { id: schedule.id } });
    expect(remainingSchedule).toBeNull();

    await prisma.auditLog.deleteMany({ where: { entity: "DutyPlan", entityId: plan.id } });
    await prisma.dutyPlanVersion.deleteMany({ where: { id: planVersion.id } });
    await prisma.dutyPlan.deleteMany({ where: { id: plan.id } });
  });

  it("rejects deleting a schedule belonging to another organization", async () => {
    const regionA = await createTestRegion(tracked);
    const regionB = await createTestRegion(tracked);
    const pharmacyB = await createTestPharmacy(tracked, regionB.id);
    const adminA = await createTestUser(tracked, { role: "ADMIN", organizationId: regionA.organizationId });
    const token = await createTestSessionToken(adminA.id);
    setIntegrationTestSessionToken(token);

    const scheduleB = await prisma.dutySchedule.create({
      data: { month: 8, year: 2028, regionId: regionB.id, status: "DRAFT" },
    });
    tracked.dutyScheduleIds.push(scheduleB.id);
    await prisma.dutyAssignment.create({
      data: {
        dutyScheduleId: scheduleB.id,
        date: new Date(Date.UTC(2028, 7, 1)),
        pharmacyId: pharmacyB.id,
        weight: 1,
      },
    });

    await expect(deleteDutyScheduleAction(scheduleB.id)).rejects.toThrow(IntegrationRedirectSignal);

    const stillThere = await prisma.dutySchedule.findUnique({ where: { id: scheduleB.id } });
    expect(stillThere).not.toBeNull();
  });
});
