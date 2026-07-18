import { afterEach, describe, expect, it } from "vitest";

import { prisma } from "@/lib/prisma";
import { loadDutyPlanVersion } from "@/lib/duty-rules-v2/load-duty-plan-version";
import { buildDutyEngineContext } from "@/lib/duty-rules-v2/engine/build-engine-context";
import type { DutyEngineInput, EngineSchedulingPolicy } from "@/lib/duty-rules-v2/engine/domain/engine-input";
import type { LoadedDutyPlanVersion } from "@/lib/duty-rules-v2/domain/loaded-plan";
import { buildCompatibilityRules } from "@/lib/duty-rules-v2/rules/build-compatibility-rules";
import { buildV1CompatibilitySelectionStrategy } from "@/lib/duty-rules-v2/selection/build-v1-compatibility-strategy";
import {
  commitCompleteDraft,
  type CommitCompleteDraftResult,
} from "@/lib/duty-rules-v2/persistence/commit-complete-draft";
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

// Duty Rules V2 — Phase 8: atomic Complete Draft Schedule persistence,
// against a real Postgres database. Reuses the exact persisted-plan
// pattern from the Phase 7 integration suite (organization, region,
// plan, plan version, day types, shifts, slots, pool, memberships, an
// explicit RotationState row) and feeds the REAL, unmodified Phase 4-7
// pipeline output into commitCompleteDraft — never a hand-rolled
// assignment array. Every schedule/generation-run/assignment row this
// suite creates is tracked and deleted in afterEach.
describe("commitCompleteDraft (real Postgres)", () => {
  const tracked = newTrackedIds();
  const cleanupIds = { planIds: [] as string[], poolIds: [] as string[], scheduleIds: [] as string[] };

  afterEach(async () => {
    // FK-safe order across BOTH this suite's own additions and the
    // shared fixtures' assumptions:
    // 1. Schedules first — DutyGenerationRun.planId is onDelete:
    //    Restrict, so a schedule's (Cascade-deleted) generation run must
    //    be gone before its plan can be deleted below.
    if (cleanupIds.scheduleIds.length > 0) {
      await prisma.dutyAssignment.deleteMany({ where: { dutyScheduleId: { in: cleanupIds.scheduleIds } } });
      await prisma.auditLog.deleteMany({ where: { entity: "DutySchedule", entityId: { in: cleanupIds.scheduleIds } } });
      await prisma.dutySchedule.deleteMany({ where: { id: { in: cleanupIds.scheduleIds } } });
      cleanupIds.scheduleIds.length = 0;
    }
    // 2. Plans next — Cascade-deletes DutyPlanVersion -> DayTypeRule ->
    //    SlotRequirement, releasing SlotRequirement's onDelete: Restrict
    //    FK to RotationPool before pools are deleted below. Safe now
    //    that every generation run referencing this plan is gone (step 1).
    if (cleanupIds.planIds.length > 0) {
      await prisma.dutyPlan.deleteMany({ where: { id: { in: cleanupIds.planIds } } });
      cleanupIds.planIds.length = 0;
    }
    // 3. Pools — Cascade-deletes RotationPoolMembership, releasing its
    //    onDelete: Restrict FK to Pharmacy before cleanupTrackedIds
    //    deletes the tracked pharmacies below.
    if (cleanupIds.poolIds.length > 0) {
      await prisma.rotationPool.deleteMany({ where: { id: { in: cleanupIds.poolIds } } });
      cleanupIds.poolIds.length = 0;
    }
    // 4. Pharmacies/regions/users/organizations — safe now that no
    //    RotationPoolMembership or DutySchedule references them.
    await cleanupTrackedIds(tracked);
  });

  async function buildPersistedPlan(overrides: { secondRegion?: boolean } = {}) {
    const organization = await createTestOrganization(tracked);
    const region = await createTestRegion(tracked, { organizationId: organization.id });
    const user = await createTestUser(tracked, { organizationId: organization.id, role: "ADMIN" });
    const pharmacyA = await createTestPharmacy(tracked, region.id);
    const pharmacyB = await createTestPharmacy(tracked, region.id);
    const pharmacyC = await createTestPharmacy(tracked, region.id);

    const otherRegion = overrides.secondRegion ? await createTestRegion(tracked, { organizationId: organization.id }) : null;
    const foreignPharmacy = otherRegion ? await createTestPharmacy(tracked, otherRegion.id) : null;

    const plan = await prisma.dutyPlan.create({
      data: { name: `Plan ${testRunId()}`, organizationId: organization.id, regionId: region.id },
    });
    cleanupIds.planIds.push(plan.id);
    const version = await prisma.dutyPlanVersion.create({
      data: {
        planId: plan.id,
        versionNumber: 1,
        status: "ACTIVE",
        validFrom: new Date("2026-08-01T00:00:00.000Z"),
      },
    });
    const shift = await prisma.shiftDefinition.create({
      data: { planVersionId: version.id, name: "Tam Gün", startMinute: 0, endMinute: 0 },
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

    const loaded = await loadDutyPlanVersion({
      organizationId: organization.id,
      regionId: region.id,
      planVersionId: version.id,
    });

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

    return {
      organization,
      region,
      otherRegion,
      foreignPharmacy,
      user,
      plan,
      version,
      shift,
      pool,
      memberships,
      rotationState,
      loaded,
      baseInput,
    };
  }

  function buildDraft(
    baseInput: DutyEngineInput,
    overrides: Partial<Pick<EngineSchedulingPolicy, "minDaysBetweenDuties">> = {}
  ): CompleteDraftSchedule {
    const engineInput: DutyEngineInput = {
      ...baseInput,
      policy: { ...baseInput.policy, ...overrides },
      configuredRules: buildCompatibilityRules({ ...baseInput.policy, ...overrides }),
      configuredSelectionStrategies: [
        buildV1CompatibilitySelectionStrategy({
          organizationId: baseInput.organizationId,
          regionId: baseInput.regionId,
        }),
      ],
    };
    const result = buildDutyEngineContext(engineInput);
    expect(result.completeDraftSchedule.status).toBe("COMPLETE");
    expect(result.completeDraftSchedule.isCommitEligible).toBe(true);
    return result.completeDraftSchedule;
  }

  async function snapshotRotationState(poolId: string) {
    return prisma.rotationState.findFirstOrThrow({ where: { poolId } });
  }

  function expectRotationStateUnchanged(
    before: Awaited<ReturnType<typeof snapshotRotationState>>,
    after: Awaited<ReturnType<typeof snapshotRotationState>>
  ) {
    expect(after.currentRound).toBe(before.currentRound);
    expect(after.lockVersion).toBe(before.lockVersion);
    expect(after.lastServedMembershipId).toBe(before.lastServedMembershipId);
    expect(after.carriedForward).toEqual(before.carriedForward);
    expect(after.updatedAt.toISOString()).toBe(before.updatedAt.toISOString());
  }

  async function trackSchedule(result: CommitCompleteDraftResult) {
    if (result.ok) cleanupIds.scheduleIds.push(result.dutyScheduleId);
  }

  // ---------------------------------------------------------------------
  // Atomic persistence
  // ---------------------------------------------------------------------
  it("persists schedule, generation run, and assignments together, preserving Phase 7 order/origin/provenance; RotationState untouched", async () => {
    const { region, organization, user, pool, version, plan, baseInput } = await buildPersistedPlan();
    const draft = buildDraft(baseInput);

    const before = await snapshotRotationState(pool.id);
    const result = await commitCompleteDraft({
      draft,
      organizationId: organization.id,
      regionId: region.id,
      userId: user.id,
    });
    await trackSchedule(result);
    const after = await snapshotRotationState(pool.id);
    expectRotationStateUnchanged(before, after);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.outcome).toBe("CREATED");
    expect(result.assignmentCount).toBe(draft.assignments.length);
    expect(result.completeDraftFingerprint).toBe(draft.completeDraftFingerprint);
    expect(result.scheduleStatus).toBe("DRAFT");
    expect(result.periodStart).toBe(draft.periodStart);
    expect(result.periodEnd).toBe(draft.periodEnd);

    const schedule = await prisma.dutySchedule.findUniqueOrThrow({ where: { id: result.dutyScheduleId } });
    expect(schedule.status).toBe("DRAFT");
    expect(schedule.planVersionId).toBe(version.id);
    expect(schedule.regionId).toBe(region.id);

    const run = await prisma.dutyGenerationRun.findUniqueOrThrow({ where: { id: result.generationRunId } });
    expect(run.status).toBe("COMMITTED");
    expect(run.organizationId).toBe(organization.id);
    expect(run.regionId).toBe(region.id);
    expect(run.planId).toBe(plan.id);
    expect(run.planVersionId).toBe(version.id);
    expect(run.dutyScheduleId).toBe(result.dutyScheduleId);
    expect(run.completeDraftFingerprint).toBe(draft.completeDraftFingerprint);
    expect(run.upstreamResultFingerprint).toBe(draft.manifest.sourceResultFingerprint);
    expect(run.configurationFingerprint).toBe(draft.provenance.configurationFingerprint);
    expect(run.runtimeInputHash).toBe(draft.provenance.runtimeInputHash);
    expect(run.ruleSetFingerprint).toBe(draft.provenance.ruleSetFingerprint);
    expect(run.strategySetFingerprint).toBe(draft.provenance.strategySetFingerprint);
    expect(run.engineVersion).toBe(draft.engineVersion);
    expect(run.selectionEngineVersion).toBe(draft.selectionEngineVersion);
    expect(run.draftEngineVersion).toBe(1);
    expect((run.manifest as unknown as typeof draft.manifest).assignmentKeys).toEqual(draft.manifest.assignmentKeys);

    const assignments = await prisma.dutyAssignment.findMany({
      where: { generationRunId: result.generationRunId },
      orderBy: [{ slotKey: "asc" }, { selectionOrdinal: "asc" }],
    });
    expect(assignments).toHaveLength(draft.assignments.length);
    const byKey = new Map(assignments.map((a) => [a.draftAssignmentKey, a]));
    for (const expected of draft.assignments) {
      const actual = byKey.get(expected.draftAssignmentKey);
      expect(actual, `assignment ${expected.draftAssignmentKey} persisted`).toBeDefined();
      expect(actual!.pharmacyId).toBe(expected.pharmacyId);
      expect(actual!.membershipId).toBe(expected.membershipId);
      expect(actual!.slotKey).toBe(expected.slotKey);
      expect(actual!.shiftDefinitionId).toBe(expected.shiftId);
      expect(actual!.selectionOrdinal).toBe(expected.selectionOrdinal);
      expect(actual!.origin).toBe(expected.origin);
      expect(actual!.strategyId).toBe(expected.strategyId);
      expect(actual!.strategyType).toBe(expected.strategyType);
      expect(actual!.fallbackUsed).toBe(expected.fallbackUsed);
      expect(actual!.selectedRank).toBe(expected.provisionalRank);
      expect(actual!.decisiveCriterion).toBe(expected.decisiveComparatorCriterion);
      expect(actual!.weight).toBe(expected.dutyWeight);
      expect(actual!.dutyScheduleId).toBe(result.dutyScheduleId);
      expect(actual!.isManual).toBe(false);
    }

    const auditEntry = await prisma.auditLog.findFirst({
      where: { entity: "DutySchedule", entityId: result.dutyScheduleId },
    });
    expect(auditEntry).toBeTruthy();
    expect(auditEntry?.userId).toBe(user.id);
    expect(auditEntry?.organizationId).toBe(organization.id);
    expect(auditEntry?.action).toBe("CREATE");
  });

  // ---------------------------------------------------------------------
  // Idempotency
  // ---------------------------------------------------------------------
  it("commits the same draft twice: one schedule, one generation run, one assignment set, second reports IDEMPOTENT_REPLAY", async () => {
    const { region, organization, user, baseInput } = await buildPersistedPlan();
    const draft = buildDraft(baseInput);

    const first = await commitCompleteDraft({ draft, organizationId: organization.id, regionId: region.id, userId: user.id });
    await trackSchedule(first);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.outcome).toBe("CREATED");

    const second = await commitCompleteDraft({ draft, organizationId: organization.id, regionId: region.id, userId: user.id });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.outcome).toBe("IDEMPOTENT_REPLAY");
    expect(second.dutyScheduleId).toBe(first.dutyScheduleId);
    expect(second.generationRunId).toBe(first.generationRunId);
    expect(second.assignmentCount).toBe(first.assignmentCount);

    expect(await prisma.dutySchedule.count({ where: { id: first.dutyScheduleId } })).toBe(1);
    expect(await prisma.dutyGenerationRun.count({ where: { completeDraftFingerprint: draft.completeDraftFingerprint } })).toBe(1);
    expect(await prisma.dutyAssignment.count({ where: { generationRunId: first.generationRunId } })).toBe(
      draft.assignments.length
    );
  });

  // ---------------------------------------------------------------------
  // Conflicts
  // ---------------------------------------------------------------------
  it("rejects a different-fingerprint draft for the same org/region/period target without touching the existing schedule", async () => {
    const { region, organization, user, baseInput } = await buildPersistedPlan();
    const draftA = buildDraft(baseInput, { minDaysBetweenDuties: 2 });
    const draftB = buildDraft(baseInput, { minDaysBetweenDuties: 0 });
    expect(draftB.completeDraftFingerprint).not.toBe(draftA.completeDraftFingerprint);

    const committedA = await commitCompleteDraft({ draft: draftA, organizationId: organization.id, regionId: region.id, userId: user.id });
    await trackSchedule(committedA);
    expect(committedA.ok).toBe(true);
    if (!committedA.ok) return;

    const attemptB = await commitCompleteDraft({ draft: draftB, organizationId: organization.id, regionId: region.id, userId: user.id });
    expect(attemptB).toEqual({ ok: false, code: "DRAFT_TARGET_CONFLICT", message: expect.any(String) });

    // Original schedule from A is untouched, never overwritten/deleted.
    const schedule = await prisma.dutySchedule.findUniqueOrThrow({ where: { id: committedA.dutyScheduleId } });
    expect(schedule.status).toBe("DRAFT");
    const run = await prisma.dutyGenerationRun.findUniqueOrThrow({ where: { id: committedA.generationRunId } });
    expect(run.completeDraftFingerprint).toBe(draftA.completeDraftFingerprint);
    expect(await prisma.dutySchedule.count()).toBeGreaterThanOrEqual(1);
    expect(await prisma.dutyGenerationRun.count({ where: { completeDraftFingerprint: draftB.completeDraftFingerprint } })).toBe(0);
  });

  it("rejects a cross-tenant commit attempt with DRAFT_TENANT_MISMATCH", async () => {
    const { region, baseInput } = await buildPersistedPlan();
    const draft = buildDraft(baseInput);
    const otherOrganization = await createTestOrganization(tracked);
    const otherUser = await createTestUser(tracked, { organizationId: otherOrganization.id });

    const result = await commitCompleteDraft({
      draft,
      organizationId: otherOrganization.id,
      regionId: region.id,
      userId: otherUser.id,
    });
    expect(result).toEqual({ ok: false, code: "DRAFT_TENANT_MISMATCH", message: expect.any(String) });
    expect(await prisma.dutySchedule.count({ where: { regionId: region.id } })).toBe(0);
  });

  it("rejects a draft whose membership references a pharmacy outside the target region with DRAFT_REFERENCE_MISMATCH", async () => {
    const { region, organization, user, otherRegion, foreignPharmacy, pool, baseInput } = await buildPersistedPlan({
      secondRegion: true,
    });
    expect(otherRegion).toBeTruthy();
    expect(foreignPharmacy).toBeTruthy();

    // A membership row the application would never normally create
    // (loadDutyPlanVersion itself rejects this at load time — the
    // loader's own TENANT_INTEGRITY_VIOLATION check, confirmed
    // separately): pool P belongs to `region`, but this membership's
    // pharmacy belongs to `otherRegion`. To exercise validateReferences
    // as an INDEPENDENT, defense-in-depth check (never trusting the
    // loader alone), the LoadedDutyPlanVersion is hand-built here rather
    // than produced by the real loader — the engine only trusts this
    // synthetic input, so it happily produces a self-consistent,
    // correctly-fingerprinted draft; the mismatch exists only in the
    // DATABASE, which is exactly what commitCompleteDraft must catch.
    const foreignMembership = await prisma.rotationPoolMembership.create({
      data: { poolId: pool.id, pharmacyId: foreignPharmacy!.id, joinedAt: new Date("2026-01-01T00:00:00.000Z") },
    });
    const tamperedLoaded: LoadedDutyPlanVersion = {
      ...baseInput.loadedPlan,
      rotationPools: baseInput.loadedPlan.rotationPools.map((p) =>
        p.id === pool.id
          ? {
              ...p,
              memberships: [
                {
                  id: foreignMembership.id,
                  pharmacyId: foreignPharmacy!.id,
                  pharmacyName: "Foreign Eczane",
                  pharmacyIsActive: true,
                  joinedOn: "2026-01-01",
                  leftOn: null,
                  sortIndex: null,
                },
              ],
            }
          : p
      ),
    };

    const draft = buildDraft({ ...baseInput, loadedPlan: tamperedLoaded });
    expect(draft.assignments.length).toBeGreaterThan(0);
    expect(draft.assignments.every((a) => a.membershipId === foreignMembership.id)).toBe(true);

    const result = await commitCompleteDraft({ draft, organizationId: organization.id, regionId: region.id, userId: user.id });
    expect(result).toEqual({ ok: false, code: "DRAFT_REFERENCE_MISMATCH", message: expect.any(String) });
    expect(await prisma.dutySchedule.count({ where: { regionId: region.id } })).toBe(0);
  });

  it("rejects a draft whose shift belongs to a different plan version with DRAFT_REFERENCE_MISMATCH", async () => {
    const { region, organization, user, version, pool, baseInput } = await buildPersistedPlan();

    // A second, unrelated plan version with its OWN shift definition —
    // never referenced by `version`'s own slots.
    const otherVersion = await prisma.dutyPlanVersion.create({
      data: { planId: baseInput.loadedPlan.planId, versionNumber: 2, status: "DRAFT", validFrom: new Date("2026-08-01T00:00:00.000Z") },
    });
    const foreignShift = await prisma.shiftDefinition.create({
      data: { planVersionId: otherVersion.id, name: "Yabancı Vardiya", startMinute: 0, endMinute: 0 },
    });

    // Hand-built LoadedDutyPlanVersion: declares planVersionId = the
    // REAL, persisted `version`, but its shiftDefinitions/slotRequirements
    // point at `foreignShift`, which actually belongs to `otherVersion` in
    // the database. The engine only trusts this synthetic input (never
    // re-reads the DB during generation), so it happily produces a
    // self-consistent draft — the mismatch only exists in the DATABASE,
    // which is exactly what validateReferences must independently catch.
    const tamperedLoaded: LoadedDutyPlanVersion = {
      ...baseInput.loadedPlan,
      planVersionId: version.id,
      shiftDefinitions: [
        { id: foreignShift.id, name: foreignShift.name, startMinute: 0, endMinute: 0, spansMidnight: false, defaultWeight: 1, sortOrder: 0 },
      ],
      slotRequirements: baseInput.loadedPlan.slotRequirements.map((s) => ({ ...s, shiftDefinitionId: foreignShift.id })),
    };

    const draft = buildDraft({ ...baseInput, loadedPlan: tamperedLoaded });
    expect(draft.assignments.length).toBeGreaterThan(0);
    expect(draft.assignments.every((a) => a.shiftId === foreignShift.id)).toBe(true);

    const result = await commitCompleteDraft({ draft, organizationId: organization.id, regionId: region.id, userId: user.id });
    expect(result).toEqual({ ok: false, code: "DRAFT_REFERENCE_MISMATCH", message: expect.any(String) });
    expect(await prisma.dutySchedule.count({ where: { regionId: region.id } })).toBe(0);

    await prisma.shiftDefinition.deleteMany({ where: { id: foreignShift.id } });
    await prisma.dutyPlanVersion.deleteMany({ where: { id: otherVersion.id } });
    // pool/plan cleanup still handled by afterEach via cleanupIds.
    void pool;
  });

  // ---------------------------------------------------------------------
  // Concurrency
  // ---------------------------------------------------------------------
  it("concurrent identical commits create exactly one schedule/generation-run/assignment set", async () => {
    const { region, organization, user, baseInput, pool } = await buildPersistedPlan();
    const draft = buildDraft(baseInput);

    const before = await snapshotRotationState(pool.id);
    const [a, b] = await Promise.all([
      commitCompleteDraft({ draft, organizationId: organization.id, regionId: region.id, userId: user.id }),
      commitCompleteDraft({ draft, organizationId: organization.id, regionId: region.id, userId: user.id }),
    ]);
    const after = await snapshotRotationState(pool.id);
    expectRotationStateUnchanged(before, after);

    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    await trackSchedule(a);
    // Exactly one CREATED, exactly one IDEMPOTENT_REPLAY (order not
    // guaranteed under real concurrency).
    const outcomes = [a.outcome, b.outcome].sort();
    expect(outcomes).toEqual(["CREATED", "IDEMPOTENT_REPLAY"]);
    expect(a.dutyScheduleId).toBe(b.dutyScheduleId);
    expect(a.generationRunId).toBe(b.generationRunId);

    expect(await prisma.dutySchedule.count({ where: { regionId: region.id } })).toBe(1);
    expect(await prisma.dutyGenerationRun.count({ where: { completeDraftFingerprint: draft.completeDraftFingerprint } })).toBe(1);
    expect(await prisma.dutyAssignment.count({ where: { generationRunId: a.generationRunId } })).toBe(draft.assignments.length);
  });

  it("concurrent different drafts for the same target: exactly one commits, the other gets a typed conflict, no partial state", async () => {
    const { region, organization, user, baseInput, pool } = await buildPersistedPlan();
    const draftA = buildDraft(baseInput, { minDaysBetweenDuties: 2 });
    const draftB = buildDraft(baseInput, { minDaysBetweenDuties: 0 });
    expect(draftA.completeDraftFingerprint).not.toBe(draftB.completeDraftFingerprint);

    const before = await snapshotRotationState(pool.id);
    const [a, b] = await Promise.all([
      commitCompleteDraft({ draft: draftA, organizationId: organization.id, regionId: region.id, userId: user.id }),
      commitCompleteDraft({ draft: draftB, organizationId: organization.id, regionId: region.id, userId: user.id }),
    ]);
    const after = await snapshotRotationState(pool.id);
    expectRotationStateUnchanged(before, after);

    const results = [a, b];
    const successes = results.filter((r) => r.ok);
    const failures = results.filter((r) => !r.ok);
    expect(successes).toHaveLength(1);
    expect(failures).toHaveLength(1);
    if (failures[0]!.ok) throw new Error("unreachable");
    expect(failures[0]!.code).toBe("DRAFT_TARGET_CONFLICT");
    if (!successes[0]!.ok) throw new Error("unreachable");
    await trackSchedule(successes[0]!);

    // Exactly one schedule for this target, and its assignment count
    // matches EXACTLY ONE of the two candidate drafts — never a mix.
    const schedule = await prisma.dutySchedule.findUniqueOrThrow({
      where: { id: successes[0]!.dutyScheduleId },
      include: { _count: { select: { assignments: true } } },
    });
    expect(await prisma.dutySchedule.count({ where: { regionId: region.id } })).toBe(1);
    expect([draftA.assignments.length, draftB.assignments.length]).toContain(schedule._count.assignments);
  });

  // ---------------------------------------------------------------------
  // Rollback
  // ---------------------------------------------------------------------
  const failurePoints = ["SCHEDULE_CREATED", "GENERATION_RUN_CREATED", "PARTIAL_ASSIGNMENTS"] as const;
  for (const failAfterStep of failurePoints) {
    it(`rolls back completely when the transaction fails after ${failAfterStep}: zero new rows anywhere, RotationState unchanged`, async () => {
      const { region, organization, user, baseInput, pool } = await buildPersistedPlan();
      const draft = buildDraft(baseInput);

      const beforeSchedules = await prisma.dutySchedule.count();
      const beforeRuns = await prisma.dutyGenerationRun.count();
      const beforeAssignments = await prisma.dutyAssignment.count();
      const beforeAudits = await prisma.auditLog.count();
      const before = await snapshotRotationState(pool.id);

      const result = await commitCompleteDraft(
        { draft, organizationId: organization.id, regionId: region.id, userId: user.id },
        { failAfterStep }
      );

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.code).toBe("DRAFT_TRANSACTION_FAILED");

      expect(await prisma.dutySchedule.count()).toBe(beforeSchedules);
      expect(await prisma.dutyGenerationRun.count()).toBe(beforeRuns);
      expect(await prisma.dutyAssignment.count()).toBe(beforeAssignments);
      expect(await prisma.auditLog.count()).toBe(beforeAudits);
      const after = await snapshotRotationState(pool.id);
      expectRotationStateUnchanged(before, after);

      // Confirm the target slot is genuinely free afterward — a later
      // real commit of the SAME draft must succeed cleanly.
      const retry = await commitCompleteDraft({ draft, organizationId: organization.id, regionId: region.id, userId: user.id });
      expect(retry.ok).toBe(true);
      await trackSchedule(retry);
    });
  }
});
