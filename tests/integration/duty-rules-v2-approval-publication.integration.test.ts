import { afterEach, describe, expect, it } from "vitest";

import { prisma } from "@/lib/prisma";
import { loadDutyPlanVersion } from "@/lib/duty-rules-v2/load-duty-plan-version";
import { buildDutyEngineContext } from "@/lib/duty-rules-v2/engine/build-engine-context";
import type { DutyEngineInput, EngineSchedulingPolicy } from "@/lib/duty-rules-v2/engine/domain/engine-input";
import { buildCompatibilityRules } from "@/lib/duty-rules-v2/rules/build-compatibility-rules";
import { buildV1CompatibilitySelectionStrategy } from "@/lib/duty-rules-v2/selection/build-v1-compatibility-strategy";
import { commitCompleteDraft } from "@/lib/duty-rules-v2/persistence/commit-complete-draft";
import { approveGeneratedDraft } from "@/lib/duty-rules-v2/persistence/approve-generated-draft";
import { publishApprovedSchedule } from "@/lib/duty-rules-v2/persistence/publish-approved-schedule";
import type { CompleteDraftSchedule } from "@/lib/duty-rules-v2/draft/domain/draft-schedule";
import {
  createTestOrganization,
  createTestPharmacy,
  createTestRegion,
  createTestUser,
  cleanupTrackedIds,
  newTrackedIds,
  testRunId,
} from "./helpers/fixtures";

// Duty Rules V2 — Phase 9: approve-generated-draft.ts +
// publish-approved-schedule.ts, against a real Postgres database.
// Reuses the Phase 8 persisted-plan fixture pattern, commits a REAL
// draft via the actual commitCompleteDraft (never a hand-rolled
// DutySchedule row), then drives it through DRAFT -> APPROVED ->
// PUBLISHED. Every schedule/generation-run/assignment/rotation-state row
// this suite creates or mutates is tracked and cleaned up in afterEach.
describe("approveGeneratedDraft / publishApprovedSchedule (real Postgres)", () => {
  const tracked = newTrackedIds();
  const cleanupIds = { planIds: [] as string[], poolIds: [] as string[], scheduleIds: [] as string[] };

  afterEach(async () => {
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

  async function buildPersistedPlan(overrides: { secondOrg?: boolean } = {}) {
    const organization = await createTestOrganization(tracked);
    const region = await createTestRegion(tracked, { organizationId: organization.id });
    const user = await createTestUser(tracked, { organizationId: organization.id, role: "ADMIN" });
    const pharmacyA = await createTestPharmacy(tracked, region.id);
    const pharmacyB = await createTestPharmacy(tracked, region.id);
    const pharmacyC = await createTestPharmacy(tracked, region.id);

    const otherOrganization = overrides.secondOrg ? await createTestOrganization(tracked) : null;
    const otherUser = otherOrganization ? await createTestUser(tracked, { organizationId: otherOrganization.id }) : null;

    const plan = await prisma.dutyPlan.create({
      data: { name: `Plan ${testRunId()}`, organizationId: organization.id, regionId: region.id },
    });
    cleanupIds.planIds.push(plan.id);
    const version = await prisma.dutyPlanVersion.create({
      data: { planId: plan.id, versionNumber: 1, status: "ACTIVE", validFrom: new Date("2026-08-01T00:00:00.000Z") },
    });
    const shift = await prisma.shiftDefinition.create({
      data: { planVersionId: version.id, name: "Tam Gün", startMinute: 0, endMinute: 0 },
    });
    const pool = await prisma.rotationPool.create({
      data: { name: `Havuz ${testRunId()}`, strategy: "FAIRNESS_SCORE", organizationId: organization.id, regionId: region.id },
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
    const rotationState = await prisma.rotationState.create({
      data: {
        poolId: pool.id,
        dayTypeScope: "ALL",
        currentRound: 3,
        lockVersion: 1,
        carriedForward: [{ membershipId: memberships[0].id, reason: "SKIPPED", periodKey: "2026-07" }],
        lastServedMembershipId: memberships[1].id,
      },
    });
    for (const dayType of ["WEEKDAY", "SATURDAY", "SUNDAY", "OFFICIAL_HOLIDAY", "RELIGIOUS_HOLIDAY", "HOLIDAY_EVE"] as const) {
      const rule = await prisma.dayTypeRule.create({ data: { planVersionId: version.id, dayType, isServed: true } });
      await prisma.slotRequirement.create({
        data: { dayTypeRuleId: rule.id, shiftDefinitionId: shift.id, rotationPoolId: pool.id, requiredCount: 1 },
      });
    }

    const loaded = await loadDutyPlanVersion({ organizationId: organization.id, regionId: region.id, planVersionId: version.id });

    const policy: EngineSchedulingPolicy = {
      minDaysBetweenDuties: 2,
      relaxMinIntervalWhenInsufficient: true,
      dayTypeWeights: [
        { dayTypeKey: "WEEKDAY", weight: 1 },
        { dayTypeKey: "SATURDAY", weight: 1.25 },
        { dayTypeKey: "SUNDAY", weight: 1.5 },
        { dayTypeKey: "OFFICIAL_HOLIDAY", weight: 2 },
        { dayTypeKey: "RELIGIOUS_HOLIDAY", weight: 2 },
        { dayTypeKey: "HOLIDAY_EVE", weight: 1 },
      ],
      sameDaySecondAssignmentAllowed: false,
    };

    const baseInput: DutyEngineInput = {
      loadedPlan: loaded,
      organizationId: organization.id,
      regionId: region.id,
      periodStart: "2026-08-03",
      periodEnd: "2026-08-09",
      generationMode: "PREVIEW",
      policy,
      holidays: [],
      customDayOverrides: [],
      unavailability: [],
      dutyRequests: [],
      historicalDuties: [],
      balanceAdjustments: [],
      existingAssignments: [],
    };

    return { organization, region, otherOrganization, otherUser, user, plan, version, pool, memberships, rotationState, baseInput };
  }

  function buildDraft(baseInput: DutyEngineInput, overrides: Partial<Pick<EngineSchedulingPolicy, "minDaysBetweenDuties">> = {}): CompleteDraftSchedule {
    const engineInput: DutyEngineInput = {
      ...baseInput,
      policy: { ...baseInput.policy, ...overrides },
      configuredRules: buildCompatibilityRules({ ...baseInput.policy, ...overrides }),
      configuredSelectionStrategies: [
        buildV1CompatibilitySelectionStrategy({ organizationId: baseInput.organizationId, regionId: baseInput.regionId }),
      ],
    };
    const result = buildDutyEngineContext(engineInput);
    expect(result.completeDraftSchedule.status).toBe("COMPLETE");
    return result.completeDraftSchedule;
  }

  async function commitDraft(organizationId: string, regionId: string, userId: string, draft: CompleteDraftSchedule) {
    const result = await commitCompleteDraft({ draft, organizationId, regionId, userId });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("commit failed");
    cleanupIds.scheduleIds.push(result.dutyScheduleId);
    return result;
  }

  async function snapshotRotationState(poolId: string) {
    return prisma.rotationState.findFirstOrThrow({ where: { poolId } });
  }

  // ---------------------------------------------------------------------
  // Approval
  // ---------------------------------------------------------------------
  it("approves a valid DRAFT schedule, leaves RotationState and assignments unchanged, writes an audit entry", async () => {
    const { organization, region, user, pool, baseInput } = await buildPersistedPlan();
    const draft = buildDraft(baseInput);
    const committed = await commitDraft(organization.id, region.id, user.id, draft);

    const rsBefore = await snapshotRotationState(pool.id);
    const assignmentsBefore = await prisma.dutyAssignment.findMany({ where: { generationRunId: committed.generationRunId } });

    const result = await approveGeneratedDraft({ dutyScheduleId: committed.dutyScheduleId, organizationId: organization.id, userId: user.id });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.outcome).toBe("APPROVED");
    expect(result.dutyScheduleId).toBe(committed.dutyScheduleId);
    expect(result.generationRunId).toBe(committed.generationRunId);
    expect(result.status).toBe("APPROVED");
    expect(result.approvedBy).toBe(user.id);
    expect(new Date(result.approvedAt).getTime()).not.toBeNaN();

    const schedule = await prisma.dutySchedule.findUniqueOrThrow({ where: { id: committed.dutyScheduleId } });
    expect(schedule.status).toBe("APPROVED");
    const run = await prisma.dutyGenerationRun.findUniqueOrThrow({ where: { id: committed.generationRunId } });
    expect(run.status).toBe("APPROVED");
    expect(run.approvedById).toBe(user.id);
    expect(run.approvedAt).not.toBeNull();
    expect(run.rotationStateSnapshot).not.toBeNull();
    const snapshot = run.rotationStateSnapshot as unknown as { rotationStateId: string; lockVersion: number }[];
    const rsAfter = await snapshotRotationState(pool.id);
    expect(snapshot).toEqual([{ rotationStateId: rsAfter.id, lockVersion: 1 }]);
    expect(rsAfter).toEqual(rsBefore);

    const assignmentsAfter = await prisma.dutyAssignment.findMany({ where: { generationRunId: committed.generationRunId } });
    expect(assignmentsAfter).toEqual(assignmentsBefore);

    const audit = await prisma.auditLog.findFirst({ where: { entity: "DutySchedule", entityId: committed.dutyScheduleId, action: "UPDATE" } });
    expect(audit).toBeTruthy();
    expect(audit?.userId).toBe(user.id);
  });

  it("is idempotent: approving the same already-approved schedule twice returns IDEMPOTENT_REPLAY, no duplicate state change", async () => {
    const { organization, region, user, baseInput } = await buildPersistedPlan();
    const draft = buildDraft(baseInput);
    const committed = await commitDraft(organization.id, region.id, user.id, draft);

    const first = await approveGeneratedDraft({ dutyScheduleId: committed.dutyScheduleId, organizationId: organization.id, userId: user.id });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.outcome).toBe("APPROVED");

    const second = await approveGeneratedDraft({ dutyScheduleId: committed.dutyScheduleId, organizationId: organization.id, userId: user.id });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.outcome).toBe("IDEMPOTENT_REPLAY");
    expect(second.approvedBy).toBe(first.approvedBy);
    expect(second.approvedAt).toBe(first.approvedAt);

    const auditCount = await prisma.auditLog.count({ where: { entity: "DutySchedule", entityId: committed.dutyScheduleId, action: "UPDATE" } });
    expect(auditCount).toBe(1);
  });

  it("rejects a cross-tenant approval attempt with TENANT_MISMATCH", async () => {
    const { organization, region, user, otherOrganization, otherUser, baseInput } = await buildPersistedPlan({ secondOrg: true });
    const draft = buildDraft(baseInput);
    const committed = await commitDraft(organization.id, region.id, user.id, draft);

    const result = await approveGeneratedDraft({ dutyScheduleId: committed.dutyScheduleId, organizationId: otherOrganization!.id, userId: otherUser!.id });
    expect(result).toEqual({ ok: false, code: "TENANT_MISMATCH", message: expect.any(String) });

    const schedule = await prisma.dutySchedule.findUniqueOrThrow({ where: { id: committed.dutyScheduleId } });
    expect(schedule.status).toBe("DRAFT");
  });

  it("rejects approval when the persisted assignment count no longer matches the stored manifest count (corrupted generation record)", async () => {
    const { organization, region, user, baseInput } = await buildPersistedPlan();
    const draft = buildDraft(baseInput);
    const committed = await commitDraft(organization.id, region.id, user.id, draft);

    // Simulate corruption: delete one persisted assignment row directly,
    // never through any service — the manifest's own stored count now
    // disagrees with reality.
    const oneAssignment = await prisma.dutyAssignment.findFirstOrThrow({ where: { generationRunId: committed.generationRunId } });
    await prisma.dutyAssignment.delete({ where: { id: oneAssignment.id } });

    const result = await approveGeneratedDraft({ dutyScheduleId: committed.dutyScheduleId, organizationId: organization.id, userId: user.id });
    expect(result).toEqual({ ok: false, code: "GENERATION_RECORD_CORRUPTED", message: expect.any(String) });

    const schedule = await prisma.dutySchedule.findUniqueOrThrow({ where: { id: committed.dutyScheduleId } });
    expect(schedule.status).toBe("DRAFT");
  });

  it("rejects approval of a schedule missing provenance on one assignment (incomplete generation record)", async () => {
    const { organization, region, user, baseInput } = await buildPersistedPlan();
    const draft = buildDraft(baseInput);
    const committed = await commitDraft(organization.id, region.id, user.id, draft);

    const oneAssignment = await prisma.dutyAssignment.findFirstOrThrow({ where: { generationRunId: committed.generationRunId } });
    // Corrupt just the provenance field, leave the row otherwise intact —
    // total count stays correct, only per-row completeness breaks.
    await prisma.dutyAssignment.update({ where: { id: oneAssignment.id }, data: { origin: null } });

    const result = await approveGeneratedDraft({ dutyScheduleId: committed.dutyScheduleId, organizationId: organization.id, userId: user.id });
    expect(result).toEqual({ ok: false, code: "GENERATION_RECORD_CORRUPTED", message: expect.any(String) });
  });

  it("rejects approving an already-published schedule with SCHEDULE_ALREADY_PUBLISHED", async () => {
    const { organization, region, user, baseInput } = await buildPersistedPlan();
    const draft = buildDraft(baseInput);
    const committed = await commitDraft(organization.id, region.id, user.id, draft);
    await approveGeneratedDraft({ dutyScheduleId: committed.dutyScheduleId, organizationId: organization.id, userId: user.id });
    const published = await publishApprovedSchedule({ dutyScheduleId: committed.dutyScheduleId, organizationId: organization.id, userId: user.id });
    expect(published.ok).toBe(true);

    const result = await approveGeneratedDraft({ dutyScheduleId: committed.dutyScheduleId, organizationId: organization.id, userId: user.id });
    expect(result).toEqual({ ok: false, code: "SCHEDULE_ALREADY_PUBLISHED", message: expect.any(String) });
  });

  // ---------------------------------------------------------------------
  // Publication
  // ---------------------------------------------------------------------
  it("publishes an approved schedule: schedule PUBLISHED, exactly one RotationState row advanced, assignments unchanged, audit entry created", async () => {
    const { organization, region, user, pool, memberships, baseInput } = await buildPersistedPlan();
    const draft = buildDraft(baseInput);
    const committed = await commitDraft(organization.id, region.id, user.id, draft);
    await approveGeneratedDraft({ dutyScheduleId: committed.dutyScheduleId, organizationId: organization.id, userId: user.id });

    const rsBefore = await snapshotRotationState(pool.id);
    const assignmentsBefore = await prisma.dutyAssignment.findMany({
      where: { generationRunId: committed.generationRunId },
      orderBy: { id: "asc" },
    });

    const result = await publishApprovedSchedule({ dutyScheduleId: committed.dutyScheduleId, organizationId: organization.id, userId: user.id });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.outcome).toBe("PUBLISHED");
    expect(result.status).toBe("PUBLISHED");
    expect(result.publishedBy).toBe(user.id);
    expect(result.updatedRotationStateCount).toBe(1);
    expect(new Date(result.publishedAt).getTime()).not.toBeNaN();

    const schedule = await prisma.dutySchedule.findUniqueOrThrow({ where: { id: committed.dutyScheduleId } });
    expect(schedule.status).toBe("PUBLISHED");
    const run = await prisma.dutyGenerationRun.findUniqueOrThrow({ where: { id: committed.generationRunId } });
    expect(run.status).toBe("PUBLISHED");
    expect(run.publishedById).toBe(user.id);
    expect(run.publishedAt).not.toBeNull();

    const rsAfter = await snapshotRotationState(pool.id);
    expect(rsAfter.lockVersion).toBe(rsBefore.lockVersion + 1);
    expect(rsAfter.currentRound).toBeGreaterThanOrEqual(rsBefore.currentRound);
    // The cursor must be one of this pool's real memberships (the last
    // one served, chronologically) — never invented.
    expect(memberships.map((m) => m.id)).toContain(rsAfter.lastServedMembershipId);
    expect(rsAfter.updatedAt.getTime()).toBeGreaterThan(rsBefore.updatedAt.getTime());

    const assignmentsAfter = await prisma.dutyAssignment.findMany({
      where: { generationRunId: committed.generationRunId },
      orderBy: { id: "asc" },
    });
    expect(assignmentsAfter).toEqual(assignmentsBefore);

    const audit = await prisma.auditLog.findFirst({
      where: { entity: "DutySchedule", entityId: committed.dutyScheduleId, action: "UPDATE" },
      orderBy: { createdAt: "desc" },
    });
    expect(audit).toBeTruthy();
  });

  it("rejects publishing a DRAFT (never-approved) schedule with SCHEDULE_NOT_APPROVED", async () => {
    const { organization, region, user, baseInput } = await buildPersistedPlan();
    const draft = buildDraft(baseInput);
    const committed = await commitDraft(organization.id, region.id, user.id, draft);

    const result = await publishApprovedSchedule({ dutyScheduleId: committed.dutyScheduleId, organizationId: organization.id, userId: user.id });
    expect(result).toEqual({ ok: false, code: "SCHEDULE_NOT_APPROVED", message: expect.any(String) });

    const schedule = await prisma.dutySchedule.findUniqueOrThrow({ where: { id: committed.dutyScheduleId } });
    expect(schedule.status).toBe("DRAFT");
  });

  it("leaves an UNRELATED pool's RotationState completely untouched by publication", async () => {
    const setupA = await buildPersistedPlan();
    const setupB = await buildPersistedPlan();
    const draftA = buildDraft(setupA.baseInput);
    const committedA = await commitDraft(setupA.organization.id, setupA.region.id, setupA.user.id, draftA);
    await approveGeneratedDraft({ dutyScheduleId: committedA.dutyScheduleId, organizationId: setupA.organization.id, userId: setupA.user.id });

    const unrelatedBefore = await snapshotRotationState(setupB.pool.id);

    const result = await publishApprovedSchedule({ dutyScheduleId: committedA.dutyScheduleId, organizationId: setupA.organization.id, userId: setupA.user.id });
    expect(result.ok).toBe(true);

    const unrelatedAfter = await snapshotRotationState(setupB.pool.id);
    expect(unrelatedAfter).toEqual(unrelatedBefore);
  });

  it("rejects publication when RotationState has changed since approval (stale lockVersion) with ROTATION_STATE_CONFLICT", async () => {
    const { organization, region, user, pool, baseInput } = await buildPersistedPlan();
    const draft = buildDraft(baseInput);
    const committed = await commitDraft(organization.id, region.id, user.id, draft);
    await approveGeneratedDraft({ dutyScheduleId: committed.dutyScheduleId, organizationId: organization.id, userId: user.id });

    // Something ELSE bumps the RotationState's lockVersion after
    // approval (never through this service — simulating an out-of-band
    // change, e.g. a future concurrent generation/publication).
    const rs = await snapshotRotationState(pool.id);
    await prisma.rotationState.update({ where: { id: rs.id }, data: { lockVersion: { increment: 1 } } });

    const result = await publishApprovedSchedule({ dutyScheduleId: committed.dutyScheduleId, organizationId: organization.id, userId: user.id });
    expect(result).toEqual({ ok: false, code: "ROTATION_STATE_CONFLICT", message: expect.any(String) });

    const schedule = await prisma.dutySchedule.findUniqueOrThrow({ where: { id: committed.dutyScheduleId } });
    expect(schedule.status).toBe("APPROVED");
  });

  it("concurrent identical publication requests: exactly one publishes, the other is idempotent, exactly one RotationState advancement", async () => {
    const { organization, region, user, pool, baseInput } = await buildPersistedPlan();
    const draft = buildDraft(baseInput);
    const committed = await commitDraft(organization.id, region.id, user.id, draft);
    await approveGeneratedDraft({ dutyScheduleId: committed.dutyScheduleId, organizationId: organization.id, userId: user.id });

    const rsBefore = await snapshotRotationState(pool.id);
    const [a, b] = await Promise.all([
      publishApprovedSchedule({ dutyScheduleId: committed.dutyScheduleId, organizationId: organization.id, userId: user.id }),
      publishApprovedSchedule({ dutyScheduleId: committed.dutyScheduleId, organizationId: organization.id, userId: user.id }),
    ]);
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    const outcomes = [a.outcome, b.outcome].sort();
    expect(outcomes).toEqual(["IDEMPOTENT_REPLAY", "PUBLISHED"]);
    expect(a.publishedBy).toBe(b.publishedBy);
    expect(a.publishedAt).toBe(b.publishedAt);

    const schedule = await prisma.dutySchedule.findUniqueOrThrow({ where: { id: committed.dutyScheduleId } });
    expect(schedule.status).toBe("PUBLISHED");
    const rsAfter = await snapshotRotationState(pool.id);
    // Exactly ONE advancement happened, not two.
    expect(rsAfter.lockVersion).toBe(rsBefore.lockVersion + 1);
  });

  // ---------------------------------------------------------------------
  // Rollback
  // ---------------------------------------------------------------------
  const publishFailurePoints = ["FIRST_ROTATION_UPDATE", "ALL_ROTATION_UPDATES", "SCHEDULE_STATUS_UPDATE", "AUDIT_WRITE"] as const;
  for (const failAfterStep of publishFailurePoints) {
    it(`rolls back completely when publication fails after ${failAfterStep}: schedule stays APPROVED, RotationState unchanged`, async () => {
      const { organization, region, user, pool, baseInput } = await buildPersistedPlan();
      const draft = buildDraft(baseInput);
      const committed = await commitDraft(organization.id, region.id, user.id, draft);
      await approveGeneratedDraft({ dutyScheduleId: committed.dutyScheduleId, organizationId: organization.id, userId: user.id });

      const rsBefore = await snapshotRotationState(pool.id);
      const beforeAudits = await prisma.auditLog.count();

      const result = await publishApprovedSchedule(
        { dutyScheduleId: committed.dutyScheduleId, organizationId: organization.id, userId: user.id },
        { failAfterStep }
      );
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.code).toBe("PUBLICATION_TRANSACTION_FAILED");

      const schedule = await prisma.dutySchedule.findUniqueOrThrow({ where: { id: committed.dutyScheduleId } });
      expect(schedule.status).toBe("APPROVED");
      const run = await prisma.dutyGenerationRun.findUniqueOrThrow({ where: { id: committed.generationRunId } });
      expect(run.status).toBe("APPROVED");
      expect(run.publishedById).toBeNull();
      expect(run.publishedAt).toBeNull();

      const rsAfter = await snapshotRotationState(pool.id);
      expect(rsAfter).toEqual(rsBefore);
      expect(await prisma.auditLog.count()).toBe(beforeAudits);

      // The approved slot is genuinely still publishable afterward.
      const retry = await publishApprovedSchedule({ dutyScheduleId: committed.dutyScheduleId, organizationId: organization.id, userId: user.id });
      expect(retry.ok).toBe(true);
    });
  }
});
