// Duty Rules V2 — Phase 13: manual assignment editing, against a real
// Postgres database. Mirrors
// duty-rules-v2-approval-publication.integration.test.ts's fixture
// pattern (real commitCompleteDraft/approveGeneratedDraft/
// publishApprovedSchedule pipeline, never hand-inserted rows) so the
// edited assignment's provenance is genuinely realistic. The core
// regression proof: editing a V2 assignment's pharmacyId+membershipId
// never corrupts validateGenerationRunIntegrity's checks, and never
// touches RotationState (which only ever advances once, at publish
// time).

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
import { editV2DutyAssignmentAction } from "@/app/(dashboard)/cizelgeler/[id]/atama/v2-assignment-actions";
import { IntegrationRedirectSignal, setIntegrationTestSessionToken } from "./helpers/setup";
import {
  createTestOrganization,
  createTestPharmacy,
  createTestRegion,
  createTestSessionToken,
  createTestUser,
  cleanupTrackedIds,
  newTrackedIds,
  testRunId,
} from "./helpers/fixtures";

describe("editV2DutyAssignmentAction (real Postgres)", () => {
  const tracked = newTrackedIds();
  const cleanupIds = { planIds: [] as string[], poolIds: [] as string[], scheduleIds: [] as string[] };

  afterEach(async () => {
    setIntegrationTestSessionToken(undefined);
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

  async function buildPersistedPlan(minDaysBetweenDuties = 2) {
    const organization = await createTestOrganization(tracked);
    const region = await createTestRegion(tracked, { organizationId: organization.id });
    const user = await createTestUser(tracked, { organizationId: organization.id, role: "ADMIN" });
    const pharmacyA = await createTestPharmacy(tracked, region.id);
    const pharmacyB = await createTestPharmacy(tracked, region.id);
    const pharmacyC = await createTestPharmacy(tracked, region.id);
    // A fourth pharmacy that is active/in-region but deliberately NEVER
    // added to the rotation pool — used by the "not a pool member"
    // rejection test.
    const pharmacyOutsidePool = await createTestPharmacy(tracked, region.id);

    const plan = await prisma.dutyPlan.create({
      data: { name: `Plan ${testRunId()}`, organizationId: organization.id, regionId: region.id },
    });
    cleanupIds.planIds.push(plan.id);
    // No DutyRule anywhere in this fixture — a genuinely native-mode V2
    // region, exercising Phase 13 investigation finding #6's gap.
    const version = await prisma.dutyPlanVersion.create({
      data: {
        planId: plan.id,
        versionNumber: 1,
        status: "ACTIVE",
        validFrom: new Date("2026-08-01T00:00:00.000Z"),
        minDaysBetweenDuties,
      },
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
    await prisma.rotationState.create({
      data: { poolId: pool.id, dayTypeScope: "ALL", currentRound: 0, lockVersion: 0 },
    });
    for (const dayType of ["WEEKDAY", "SATURDAY", "SUNDAY", "OFFICIAL_HOLIDAY", "RELIGIOUS_HOLIDAY", "HOLIDAY_EVE"] as const) {
      const rule = await prisma.dayTypeRule.create({ data: { planVersionId: version.id, dayType, isServed: true } });
      await prisma.slotRequirement.create({
        data: { dayTypeRuleId: rule.id, shiftDefinitionId: shift.id, rotationPoolId: pool.id, requiredCount: 1 },
      });
    }

    const loaded = await loadDutyPlanVersion({ organizationId: organization.id, regionId: region.id, planVersionId: version.id });

    const policy: EngineSchedulingPolicy = {
      minDaysBetweenDuties,
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
      user,
      plan,
      version,
      pool,
      memberships,
      pharmacyA,
      pharmacyB,
      pharmacyC,
      pharmacyOutsidePool,
      baseInput,
    };
  }

  function buildDraft(baseInput: DutyEngineInput): CompleteDraftSchedule {
    const engineInput: DutyEngineInput = {
      ...baseInput,
      configuredRules: buildCompatibilityRules(baseInput.policy),
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

  function makeFormData(fields: Record<string, string>): FormData {
    const fd = new FormData();
    for (const [key, value] of Object.entries(fields)) fd.set(key, value);
    return fd;
  }

  async function runEditAction(
    assignmentId: string,
    fields: Record<string, string>
  ): Promise<{ redirectPath: string } | { state: Awaited<ReturnType<typeof editV2DutyAssignmentAction>> }> {
    try {
      const state = await editV2DutyAssignmentAction(
        assignmentId,
        { success: false, message: "" },
        makeFormData(fields)
      );
      return { state };
    } catch (error) {
      if (error instanceof IntegrationRedirectSignal) return { redirectPath: error.path };
      throw error;
    }
  }

  async function snapshotRotationState(poolId: string) {
    return prisma.rotationState.findFirstOrThrow({ where: { poolId } });
  }

  it("edits a DRAFT-status V2 assignment to a different pool member: membershipId updated, slotKey/draftAssignmentKey/selectionOrdinal/origin unchanged, isManual true — then approve/publish still succeed (core regression proof)", async () => {
    const setup = await buildPersistedPlan();
    const draft = buildDraft(setup.baseInput);
    const committed = await commitDraft(setup.organization.id, setup.region.id, setup.user.id, draft);
    const token = await createTestSessionToken(setup.user.id);
    setIntegrationTestSessionToken(token);

    const before = await prisma.dutyAssignment.findFirstOrThrow({
      where: { generationRunId: committed.generationRunId },
      orderBy: { date: "asc" },
    });
    const membershipByPharmacy = new Map(setup.memberships.map((m) => [m.pharmacyId, m.id]));
    const candidatePharmacyId = [setup.pharmacyA.id, setup.pharmacyB.id, setup.pharmacyC.id].find(
      (id) => id !== before.pharmacyId
    )!;

    const outcome = await runEditAction(before.id, {
      pharmacyId: candidatePharmacyId,
      reason: "Entegrasyon testi düzeltmesi",
      confirmOverride: "true",
    });
    expect("redirectPath" in outcome).toBe(true);

    const after = await prisma.dutyAssignment.findUniqueOrThrow({ where: { id: before.id } });
    expect(after.pharmacyId).toBe(candidatePharmacyId);
    expect(after.membershipId).toBe(membershipByPharmacy.get(candidatePharmacyId));
    expect(after.isManual).toBe(true);
    expect(after.note).toBe("Entegrasyon testi düzeltmesi");
    // Historically-accurate provenance fields must survive untouched.
    expect(after.slotKey).toBe(before.slotKey);
    expect(after.draftAssignmentKey).toBe(before.draftAssignmentKey);
    expect(after.selectionOrdinal).toBe(before.selectionOrdinal);
    expect(after.origin).toBe(before.origin);
    expect(after.generationRunId).toBe(before.generationRunId);

    // Core regression proof: approveGeneratedDraft still succeeds against
    // the SAME dutyScheduleId after this edit — proving the edit did not
    // corrupt validateGenerationRunIntegrity's checks.
    const approveResult = await approveGeneratedDraft({
      dutyScheduleId: committed.dutyScheduleId,
      organizationId: setup.organization.id,
      userId: setup.user.id,
    });
    expect(approveResult.ok).toBe(true);

    const publishResult = await publishApprovedSchedule({
      dutyScheduleId: committed.dutyScheduleId,
      organizationId: setup.organization.id,
      userId: setup.user.id,
    });
    expect(publishResult.ok).toBe(true);
  });

  it("editing a PUBLISHED V2 assignment succeeds and leaves RotationState for the pool byte-for-byte unchanged", async () => {
    const setup = await buildPersistedPlan();
    const draft = buildDraft(setup.baseInput);
    const committed = await commitDraft(setup.organization.id, setup.region.id, setup.user.id, draft);
    await approveGeneratedDraft({ dutyScheduleId: committed.dutyScheduleId, organizationId: setup.organization.id, userId: setup.user.id });
    await publishApprovedSchedule({ dutyScheduleId: committed.dutyScheduleId, organizationId: setup.organization.id, userId: setup.user.id });

    const token = await createTestSessionToken(setup.user.id);
    setIntegrationTestSessionToken(token);

    const rsBefore = await snapshotRotationState(setup.pool.id);

    const before = await prisma.dutyAssignment.findFirstOrThrow({
      where: { generationRunId: committed.generationRunId },
      orderBy: { date: "asc" },
    });
    const candidatePharmacyId = [setup.pharmacyA.id, setup.pharmacyB.id, setup.pharmacyC.id].find(
      (id) => id !== before.pharmacyId
    )!;

    const outcome = await runEditAction(before.id, {
      pharmacyId: candidatePharmacyId,
      reason: "Yayın sonrası düzeltme",
      confirmOverride: "true",
    });
    expect("redirectPath" in outcome).toBe(true);

    const after = await prisma.dutyAssignment.findUniqueOrThrow({ where: { id: before.id } });
    expect(after.pharmacyId).toBe(candidatePharmacyId);
    expect(after.isManual).toBe(true);

    const rsAfter = await snapshotRotationState(setup.pool.id);
    expect(rsAfter).toEqual(rsBefore);
  });

  it("rejects a candidate that is not a member of the assignment's rotation pool, DB state unchanged", async () => {
    const setup = await buildPersistedPlan();
    const draft = buildDraft(setup.baseInput);
    const committed = await commitDraft(setup.organization.id, setup.region.id, setup.user.id, draft);
    const token = await createTestSessionToken(setup.user.id);
    setIntegrationTestSessionToken(token);

    const before = await prisma.dutyAssignment.findFirstOrThrow({
      where: { generationRunId: committed.generationRunId },
      orderBy: { date: "asc" },
    });

    const outcome = await runEditAction(before.id, {
      pharmacyId: setup.pharmacyOutsidePool.id,
      reason: "Havuz dışı deneme",
      confirmOverride: "true",
    });
    expect("state" in outcome).toBe(true);
    if (!("state" in outcome)) throw new Error("expected a state result");
    expect(outcome.state.success).toBe(false);
    expect(outcome.state.errors?.pharmacyId?.[0]).toMatch(/rotasyon havuzunun üyesi değil/);

    const after = await prisma.dutyAssignment.findUniqueOrThrow({ where: { id: before.id } });
    expect(after.pharmacyId).toBe(before.pharmacyId);
    expect(after.membershipId).toBe(before.membershipId);
    expect(after.isManual).toBe(before.isManual);
  });

  it("rejects a candidate blocked by an approved CANNOT_DUTY request on the assignment's date, DB state unchanged", async () => {
    const setup = await buildPersistedPlan();
    const draft = buildDraft(setup.baseInput);
    const committed = await commitDraft(setup.organization.id, setup.region.id, setup.user.id, draft);
    const token = await createTestSessionToken(setup.user.id);
    setIntegrationTestSessionToken(token);

    const before = await prisma.dutyAssignment.findFirstOrThrow({
      where: { generationRunId: committed.generationRunId },
      orderBy: { date: "asc" },
    });
    const candidatePharmacyId = [setup.pharmacyA.id, setup.pharmacyB.id, setup.pharmacyC.id].find(
      (id) => id !== before.pharmacyId
    )!;

    await prisma.dutyRequest.create({
      data: {
        pharmacyId: candidatePharmacyId,
        regionId: setup.region.id,
        requestType: "CANNOT_DUTY",
        status: "APPROVED",
        source: "ADMIN_ENTRY",
        explanation: "Entegrasyon testi",
        startDate: before.date,
        endDate: before.date,
      },
    });

    const outcome = await runEditAction(before.id, {
      pharmacyId: candidatePharmacyId,
      reason: "Engellenmiş adaya deneme",
      confirmOverride: "true",
    });
    expect("state" in outcome).toBe(true);
    if (!("state" in outcome)) throw new Error("expected a state result");
    expect(outcome.state.success).toBe(false);
    expect(outcome.state.errors?.pharmacyId?.[0]).toMatch(/onaylı nöbet tutamama/);

    const after = await prisma.dutyAssignment.findUniqueOrThrow({ where: { id: before.id } });
    expect(after.pharmacyId).toBe(before.pharmacyId);
  });

  it("fires the min-interval warning for a native-mode (no DutyRule) V2 region and proceeds once confirmed", async () => {
    // A deliberately large minDaysBetweenDuties (10, over a 7-day
    // generation period with 3 pool members) guarantees any candidate's
    // OTHER assignment lands within the violation window.
    const setup = await buildPersistedPlan(10);
    const draft = buildDraft(setup.baseInput);
    const committed = await commitDraft(setup.organization.id, setup.region.id, setup.user.id, draft);
    const token = await createTestSessionToken(setup.user.id);
    setIntegrationTestSessionToken(token);

    // Confirm this region genuinely has no DutyRule row at all — the
    // exact gap from Phase 13 investigation finding #6.
    const dutyRule = await prisma.dutyRule.findUnique({ where: { regionId: setup.region.id } });
    expect(dutyRule).toBeNull();

    const assignments = await prisma.dutyAssignment.findMany({
      where: { generationRunId: committed.generationRunId },
      orderBy: { date: "asc" },
    });
    const target = assignments[0];
    const candidatePharmacyId = [setup.pharmacyA.id, setup.pharmacyB.id, setup.pharmacyC.id].find(
      (id) => id !== target.pharmacyId
    )!;

    const warned = await runEditAction(target.id, {
      pharmacyId: candidatePharmacyId,
      reason: "Aralık ihlali denemesi",
    });
    expect("state" in warned).toBe(true);
    if (!("state" in warned)) throw new Error("expected a state result");
    expect(warned.state.requiresConfirmation).toBe(true);
    expect(warned.state.warning).toMatch(/Asgari nöbet aralığı kuralı \(10 gün\)/);

    const unchanged = await prisma.dutyAssignment.findUniqueOrThrow({ where: { id: target.id } });
    expect(unchanged.pharmacyId).toBe(target.pharmacyId);

    const confirmed = await runEditAction(target.id, {
      pharmacyId: candidatePharmacyId,
      reason: "Aralık ihlali denemesi",
      confirmOverride: "true",
    });
    expect("redirectPath" in confirmed).toBe(true);

    const after = await prisma.dutyAssignment.findUniqueOrThrow({ where: { id: target.id } });
    expect(after.pharmacyId).toBe(candidatePharmacyId);
  });

  it("rejects a cross-tenant edit attempt, DB state unchanged", async () => {
    const setup = await buildPersistedPlan();
    const draft = buildDraft(setup.baseInput);
    const committed = await commitDraft(setup.organization.id, setup.region.id, setup.user.id, draft);

    const otherOrganization = await createTestOrganization(tracked);
    const otherUser = await createTestUser(tracked, { organizationId: otherOrganization.id, role: "ADMIN" });
    const otherToken = await createTestSessionToken(otherUser.id);
    setIntegrationTestSessionToken(otherToken);

    const before = await prisma.dutyAssignment.findFirstOrThrow({
      where: { generationRunId: committed.generationRunId },
      orderBy: { date: "asc" },
    });
    const candidatePharmacyId = [setup.pharmacyA.id, setup.pharmacyB.id, setup.pharmacyC.id].find(
      (id) => id !== before.pharmacyId
    )!;

    const outcome = await runEditAction(before.id, {
      pharmacyId: candidatePharmacyId,
      reason: "Kiracılar arası deneme",
      confirmOverride: "true",
    });
    expect("state" in outcome).toBe(true);
    if (!("state" in outcome)) throw new Error("expected a state result");
    expect(outcome.state).toEqual({ success: false, message: "Nöbet ataması bulunamadı." });

    const after = await prisma.dutyAssignment.findUniqueOrThrow({ where: { id: before.id } });
    expect(after.pharmacyId).toBe(before.pharmacyId);
  });
});
