import { afterEach, describe, expect, it } from "vitest";

import { prisma } from "@/lib/prisma";
import { assembleV1CompatibilityEngineInput } from "@/lib/duty-rules-v2/ui/assemble-v1-compatibility-engine-input";
import {
  saveDraftPreview,
  loadDraftPreview,
  markDraftPreviewConsumed,
} from "@/lib/duty-rules-v2/ui/draft-preview-store";
import { buildDutyEngineContext } from "@/lib/duty-rules-v2/engine/build-engine-context";
import { commitCompleteDraft } from "@/lib/duty-rules-v2/persistence/commit-complete-draft";
import { approveGeneratedDraft } from "@/lib/duty-rules-v2/persistence/approve-generated-draft";
import { publishApprovedSchedule } from "@/lib/duty-rules-v2/persistence/publish-approved-schedule";
import {
  createTestOrganization,
  createTestPharmacy,
  createTestRegion,
  createTestUser,
  createTestDutyRule,
  cleanupTrackedIds,
  newTrackedIds,
  testRunId,
} from "./helpers/fixtures";

// Duty Rules V2 — Phase 10: admin UI integration glue, against a real
// Postgres database. Builds a full persisted plan (plan/version/day-type
// rules/shift/slots/pool/memberships/rotation state) plus a region-level
// DutyRule (V1 compatibility policy source), then exercises the SAME
// functions the UI server actions call — never a hand-rolled engine
// input.
describe("Duty Rules V2 UI integration (real Postgres)", () => {
  const tracked = newTrackedIds();
  const cleanupIds = { planIds: [] as string[], poolIds: [] as string[], scheduleIds: [] as string[], previewIds: [] as string[] };

  afterEach(async () => {
    if (cleanupIds.previewIds.length > 0) {
      await prisma.dutyDraftPreview.deleteMany({ where: { id: { in: cleanupIds.previewIds } } });
      cleanupIds.previewIds.length = 0;
    }
    if (cleanupIds.scheduleIds.length > 0) {
      await prisma.dutyAssignment.deleteMany({ where: { dutyScheduleId: { in: cleanupIds.scheduleIds } } });
      await prisma.auditLog.deleteMany({ where: { entity: "DutySchedule", entityId: { in: cleanupIds.scheduleIds } } });
      await prisma.dutySchedule.deleteMany({ where: { id: { in: cleanupIds.scheduleIds } } });
      cleanupIds.scheduleIds.length = 0;
    }
    if (cleanupIds.planIds.length > 0) {
      await prisma.dutyPlan.deleteMany({ where: { id: { in: cleanupIds.planIds } } });
      cleanupIds.planIds.length = 0;
    }
    if (cleanupIds.poolIds.length > 0) {
      await prisma.rotationPool.deleteMany({ where: { id: { in: cleanupIds.poolIds } } });
      cleanupIds.poolIds.length = 0;
    }
    await cleanupTrackedIds(tracked);
  });

  async function buildPersistedPlan(overrides: { activateVersion?: boolean } = {}) {
    const activateVersion = overrides.activateVersion ?? true;
    const organization = await createTestOrganization(tracked);
    const region = await createTestRegion(tracked, { organizationId: organization.id });
    const user = await createTestUser(tracked, { organizationId: organization.id, role: "ADMIN" });
    await createTestDutyRule(region.id);
    const pharmacyA = await createTestPharmacy(tracked, region.id);
    const pharmacyB = await createTestPharmacy(tracked, region.id);
    const pharmacyC = await createTestPharmacy(tracked, region.id);

    const plan = await prisma.dutyPlan.create({
      data: { name: `Plan ${testRunId()}`, organizationId: organization.id, regionId: region.id },
    });
    cleanupIds.planIds.push(plan.id);
    const version = await prisma.dutyPlanVersion.create({
      data: {
        planId: plan.id,
        versionNumber: 1,
        status: activateVersion ? "ACTIVE" : "DRAFT",
        validFrom: new Date("2026-01-01T00:00:00.000Z"),
      },
    });
    const shift = await prisma.shiftDefinition.create({
      data: { planVersionId: version.id, name: "Tam Gün", startMinute: 0, endMinute: 1439 },
    });
    const pool = await prisma.rotationPool.create({
      data: {
        name: `Havuz ${testRunId()}`,
        strategy: "FAIRNESS_SCORE",
        organizationId: organization.id,
        regionId: region.id,
      },
    });
    cleanupIds.poolIds.push(pool.id);
    const memberships = [];
    for (const pharmacy of [pharmacyA, pharmacyB, pharmacyC]) {
      memberships.push(
        await prisma.rotationPoolMembership.create({
          data: { poolId: pool.id, pharmacyId: pharmacy.id, joinedAt: new Date("2026-01-01T00:00:00.000Z") },
        })
      );
    }
    await prisma.rotationState.create({
      data: { poolId: pool.id, dayTypeScope: "ALL", currentRound: 0, lockVersion: 0 },
    });
    for (const dayType of [
      "WEEKDAY",
      "SATURDAY",
      "SUNDAY",
      "OFFICIAL_HOLIDAY",
      "RELIGIOUS_HOLIDAY",
      "HOLIDAY_EVE",
    ] as const) {
      const rule = await prisma.dayTypeRule.create({
        data: { planVersionId: version.id, dayType, isServed: true },
      });
      await prisma.slotRequirement.create({
        data: { dayTypeRuleId: rule.id, shiftDefinitionId: shift.id, rotationPoolId: pool.id, requiredCount: 1 },
      });
    }

    return { organization, region, user, plan, version, pool, memberships };
  }

  // ---------------------------------------------------------------------
  // assembleV1CompatibilityEngineInput
  // ---------------------------------------------------------------------

  it("assembles a valid engine input producing a COMPLETE, commit-eligible draft", async () => {
    const { organization, region } = await buildPersistedPlan();

    const result = await assembleV1CompatibilityEngineInput({
      organizationId: organization.id,
      regionId: region.id,
      periodStart: "2026-09-07",
      periodEnd: "2026-09-13",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const engineResult = buildDutyEngineContext(result.input);
    expect(engineResult.completeDraftSchedule.status).toBe("COMPLETE");
    expect(engineResult.completeDraftSchedule.isCommitEligible).toBe(true);
    expect(engineResult.completeDraftSchedule.assignments.length).toBeGreaterThan(0);
  });

  it("returns NO_ACTIVE_PLAN_VERSION when the only plan version is DRAFT, not ACTIVE", async () => {
    const { organization, region } = await buildPersistedPlan({ activateVersion: false });

    const result = await assembleV1CompatibilityEngineInput({
      organizationId: organization.id,
      regionId: region.id,
      periodStart: "2026-09-07",
      periodEnd: "2026-09-13",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("NO_ACTIVE_PLAN_VERSION");
  });

  it("returns NO_DUTY_RULE when the region has no DutyRule", async () => {
    const organization = await createTestOrganization(tracked);
    const region = await createTestRegion(tracked, { organizationId: organization.id });
    await createTestPharmacy(tracked, region.id);

    const result = await assembleV1CompatibilityEngineInput({
      organizationId: organization.id,
      regionId: region.id,
      periodStart: "2026-09-07",
      periodEnd: "2026-09-13",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("NO_DUTY_RULE");
  });

  it("returns NO_ACTIVE_PHARMACIES when the region has no active pharmacy", async () => {
    const organization = await createTestOrganization(tracked);
    const region = await createTestRegion(tracked, { organizationId: organization.id });
    await createTestDutyRule(region.id);

    const result = await assembleV1CompatibilityEngineInput({
      organizationId: organization.id,
      regionId: region.id,
      periodStart: "2026-09-07",
      periodEnd: "2026-09-13",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("NO_ACTIVE_PHARMACIES");
  });

  it("returns INVALID_PERIOD when periodStart is after periodEnd", async () => {
    const { organization, region } = await buildPersistedPlan();

    const result = await assembleV1CompatibilityEngineInput({
      organizationId: organization.id,
      regionId: region.id,
      periodStart: "2026-09-13",
      periodEnd: "2026-09-07",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("INVALID_PERIOD");
  });

  it("returns DUPLICATE_SCHEDULE_EXISTS when a schedule already exists for the requested month/region", async () => {
    const { organization, region } = await buildPersistedPlan();
    const schedule = await prisma.dutySchedule.create({
      data: { year: 2026, month: 9, regionId: region.id, status: "DRAFT" },
    });
    cleanupIds.scheduleIds.push(schedule.id);

    const result = await assembleV1CompatibilityEngineInput({
      organizationId: organization.id,
      regionId: region.id,
      periodStart: "2026-09-07",
      periodEnd: "2026-09-13",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("DUPLICATE_SCHEDULE_EXISTS");
  });

  it("returns REGION_NOT_FOUND (never a distinguishing error) for a region belonging to another organization", async () => {
    const { region } = await buildPersistedPlan();
    const otherOrganization = await createTestOrganization(tracked);

    const result = await assembleV1CompatibilityEngineInput({
      organizationId: otherOrganization.id,
      regionId: region.id,
      periodStart: "2026-09-07",
      periodEnd: "2026-09-13",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("REGION_NOT_FOUND");
  });

  // ---------------------------------------------------------------------
  // draft-preview-store
  // ---------------------------------------------------------------------

  it("round-trips a real generated draft through save/load/markConsumed", async () => {
    const { organization, region, user } = await buildPersistedPlan();
    const assembled = await assembleV1CompatibilityEngineInput({
      organizationId: organization.id,
      regionId: region.id,
      periodStart: "2026-09-07",
      periodEnd: "2026-09-13",
    });
    expect(assembled.ok).toBe(true);
    if (!assembled.ok) return;
    const engineResult = buildDutyEngineContext(assembled.input);

    const { previewId } = await saveDraftPreview({
      organizationId: organization.id,
      regionId: region.id,
      planVersionId: assembled.planVersionId,
      createdById: user.id,
      draft: engineResult.completeDraftSchedule,
    });
    cleanupIds.previewIds.push(previewId);

    const loaded = await loadDraftPreview({ previewId, organizationId: organization.id });
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.draft.completeDraftFingerprint).toBe(
      engineResult.completeDraftSchedule.completeDraftFingerprint
    );
    expect(loaded.draft.assignments.length).toBe(engineResult.completeDraftSchedule.assignments.length);

    await markDraftPreviewConsumed(previewId);
    const afterConsume = await loadDraftPreview({ previewId, organizationId: organization.id });
    expect(afterConsume.ok).toBe(false);
    if (afterConsume.ok) return;
    expect(afterConsume.code).toBe("ALREADY_CONSUMED");
  });

  it("rejects an expired preview row", async () => {
    const { organization, region, user, version } = await buildPersistedPlan();
    const row = await prisma.dutyDraftPreview.create({
      data: {
        status: "COMPLETE",
        isCommitEligible: true,
        periodStart: new Date("2026-09-07T00:00:00.000Z"),
        periodEnd: new Date("2026-09-13T00:00:00.000Z"),
        assignmentCount: 0,
        missingAssignmentCount: 0,
        warningCount: 0,
        completeDraftFingerprint: `expired-${testRunId()}`,
        payload: {},
        expiresAt: new Date(Date.now() - 60_000),
        organizationId: organization.id,
        regionId: region.id,
        planVersionId: version.id,
        createdById: user.id,
      },
    });
    cleanupIds.previewIds.push(row.id);

    const loaded = await loadDraftPreview({ previewId: row.id, organizationId: organization.id });
    expect(loaded.ok).toBe(false);
    if (loaded.ok) return;
    expect(loaded.code).toBe("EXPIRED");
  });

  it("returns NOT_FOUND for a preview belonging to another tenant", async () => {
    const { organization, region, user, version } = await buildPersistedPlan();
    const otherOrganization = await createTestOrganization(tracked);
    const row = await prisma.dutyDraftPreview.create({
      data: {
        status: "COMPLETE",
        isCommitEligible: true,
        periodStart: new Date("2026-09-07T00:00:00.000Z"),
        periodEnd: new Date("2026-09-13T00:00:00.000Z"),
        assignmentCount: 0,
        missingAssignmentCount: 0,
        warningCount: 0,
        completeDraftFingerprint: `tenant-${testRunId()}`,
        payload: {},
        expiresAt: new Date(Date.now() + 60_000),
        organizationId: organization.id,
        regionId: region.id,
        planVersionId: version.id,
        createdById: user.id,
      },
    });
    cleanupIds.previewIds.push(row.id);

    const loaded = await loadDraftPreview({ previewId: row.id, organizationId: otherOrganization.id });
    expect(loaded.ok).toBe(false);
    if (loaded.ok) return;
    expect(loaded.code).toBe("NOT_FOUND");
  });

  // ---------------------------------------------------------------------
  // Full pipeline: generate -> save preview -> load -> commit -> approve
  // -> publish.
  // ---------------------------------------------------------------------

  it("runs the full generate -> save -> commit -> approve -> publish pipeline, advancing RotationState only at publish", async () => {
    const { organization, region, user, pool } = await buildPersistedPlan();

    const assembled = await assembleV1CompatibilityEngineInput({
      organizationId: organization.id,
      regionId: region.id,
      periodStart: "2026-09-07",
      periodEnd: "2026-09-13",
    });
    expect(assembled.ok).toBe(true);
    if (!assembled.ok) return;
    const engineResult = buildDutyEngineContext(assembled.input);
    expect(engineResult.completeDraftSchedule.status).toBe("COMPLETE");

    const { previewId } = await saveDraftPreview({
      organizationId: organization.id,
      regionId: region.id,
      planVersionId: assembled.planVersionId,
      createdById: user.id,
      draft: engineResult.completeDraftSchedule,
    });
    cleanupIds.previewIds.push(previewId);

    const loaded = await loadDraftPreview({ previewId, organizationId: organization.id });
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;

    const rotationBefore = await prisma.rotationState.findFirstOrThrow({ where: { poolId: pool.id } });

    const commitResult = await commitCompleteDraft({
      draft: loaded.draft,
      organizationId: organization.id,
      regionId: region.id,
      userId: user.id,
    });
    expect(commitResult.ok).toBe(true);
    if (!commitResult.ok) return;
    cleanupIds.scheduleIds.push(commitResult.dutyScheduleId);
    expect(commitResult.scheduleStatus).toBe("DRAFT");
    await markDraftPreviewConsumed(previewId);

    const rotationAfterCommit = await prisma.rotationState.findFirstOrThrow({ where: { poolId: pool.id } });
    expect(rotationAfterCommit.currentRound).toBe(rotationBefore.currentRound);
    expect(rotationAfterCommit.lockVersion).toBe(rotationBefore.lockVersion);

    const approveResult = await approveGeneratedDraft({
      dutyScheduleId: commitResult.dutyScheduleId,
      organizationId: organization.id,
      userId: user.id,
    });
    expect(approveResult.ok).toBe(true);
    if (!approveResult.ok) return;
    expect(approveResult.outcome).toBe("APPROVED");
    expect(approveResult.status).toBe("APPROVED");

    const scheduleAfterApproval = await prisma.dutySchedule.findUniqueOrThrow({
      where: { id: commitResult.dutyScheduleId },
    });
    expect(scheduleAfterApproval.status).toBe("APPROVED");
    const rotationAfterApproval = await prisma.rotationState.findFirstOrThrow({ where: { poolId: pool.id } });
    expect(rotationAfterApproval.currentRound).toBe(rotationBefore.currentRound);
    expect(rotationAfterApproval.lockVersion).toBe(rotationBefore.lockVersion);

    const publishResult = await publishApprovedSchedule({
      dutyScheduleId: commitResult.dutyScheduleId,
      organizationId: organization.id,
      userId: user.id,
    });
    expect(publishResult.ok).toBe(true);
    if (!publishResult.ok) return;
    expect(publishResult.outcome).toBe("PUBLISHED");
    expect(publishResult.updatedRotationStateCount).toBeGreaterThan(0);

    const scheduleAfterPublish = await prisma.dutySchedule.findUniqueOrThrow({
      where: { id: commitResult.dutyScheduleId },
    });
    expect(scheduleAfterPublish.status).toBe("PUBLISHED");
    const rotationAfterPublish = await prisma.rotationState.findFirstOrThrow({ where: { poolId: pool.id } });
    expect(rotationAfterPublish.lockVersion).toBe(rotationBefore.lockVersion + 1);
  });
});
