import { afterEach, describe, expect, it } from "vitest";

import { prisma } from "@/lib/prisma";
import { loadDutyPlanVersion } from "@/lib/duty-rules-v2/load-duty-plan-version";
import { buildDutyEngineContext } from "@/lib/duty-rules-v2/engine/build-engine-context";
import type { DutyEngineInput, EngineSchedulingPolicy } from "@/lib/duty-rules-v2/engine/domain/engine-input";
import { canonicalSerialize } from "@/lib/duty-rules-v2/v1-adapter";
import { buildCompatibilityRules } from "@/lib/duty-rules-v2/rules/build-compatibility-rules";
import { buildV1CompatibilitySelectionStrategy } from "@/lib/duty-rules-v2/selection/build-v1-compatibility-strategy";
import {
  createTestOrganization,
  createTestPharmacy,
  createTestRegion,
  cleanupTrackedIds,
  newTrackedIds,
  testRunId,
} from "./helpers/fixtures";

// Duty Rules V2 — Phase 7 optional integration: a REAL persisted plan
// (organization, region, plan, plan version, day types, shifts, slots,
// pool, memberships, and an explicit RotationState row) is loaded
// through the Phase 3 loader and fed through the actual Phase 4-7
// pipeline (buildDutyEngineContext, now additively producing
// completeDraftSchedule). Rules and selection strategies are supplied
// as explicit in-memory input (buildCompatibilityRules /
// buildV1CompatibilitySelectionStrategy) — Phase 5/6 configuration
// persistence does not exist yet, so this is not a gap introduced by
// Phase 7. Deterministic draft output, zero writes anywhere.
describe("duty rules v2 Complete Draft Schedule from a persisted plan (real Postgres)", () => {
  const tracked = newTrackedIds();
  const v2 = { planIds: [] as string[], poolIds: [] as string[] };

  afterEach(async () => {
    if (v2.planIds.length > 0) {
      await prisma.dutyPlan.deleteMany({ where: { id: { in: v2.planIds } } });
      v2.planIds.length = 0;
    }
    if (v2.poolIds.length > 0) {
      await prisma.rotationPool.deleteMany({ where: { id: { in: v2.poolIds } } });
      v2.poolIds.length = 0;
    }
    await cleanupTrackedIds(tracked);
  });

  async function buildPersistedPlan() {
    const organization = await createTestOrganization(tracked);
    const region = await createTestRegion(tracked, { organizationId: organization.id });
    const pharmacyA = await createTestPharmacy(tracked, region.id);
    const pharmacyB = await createTestPharmacy(tracked, region.id);

    const plan = await prisma.dutyPlan.create({
      data: { name: `Plan ${testRunId()}`, organizationId: organization.id, regionId: region.id },
    });
    v2.planIds.push(plan.id);
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
    v2.poolIds.push(pool.id);
    const memberships = [];
    for (const pharmacy of [pharmacyA, pharmacyB]) {
      memberships.push(
        await prisma.rotationPoolMembership.create({
          data: { poolId: pool.id, pharmacyId: pharmacy.id, joinedAt: new Date("2026-01-01T00:00:00.000Z") },
        })
      );
    }
    // Explicit persisted RotationState row (Model A's "whose turn is
    // it" cursor) — never advanced by anything under test; snapshotted
    // before/after to prove Phase 7 assembly touches it not at all.
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
        data: {
          dayTypeRuleId: rule.id,
          shiftDefinitionId: shift.id,
          rotationPoolId: pool.id,
          requiredCount: 1,
        },
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

    return { organization, region, plan, version, pool, memberships, rotationState, baseInput };
  }

  async function snapshotDbState(versionId: string, poolId: string) {
    const counts = {
      schedules: await prisma.dutySchedule.count(),
      assignments: await prisma.dutyAssignment.count(),
      versions: await prisma.dutyPlanVersion.count(),
      states: await prisma.rotationState.count(),
      memberships: await prisma.rotationPoolMembership.count(),
    };
    const version = await prisma.dutyPlanVersion.findUniqueOrThrow({ where: { id: versionId } });
    const states = await prisma.rotationState.findMany({ where: { poolId }, orderBy: { id: "asc" } });
    const memberships = await prisma.rotationPoolMembership.findMany({
      where: { poolId },
      orderBy: { id: "asc" },
    });
    return { counts, version, states, memberships };
  }

  function expectDbUnchanged(
    before: Awaited<ReturnType<typeof snapshotDbState>>,
    after: Awaited<ReturnType<typeof snapshotDbState>>
  ) {
    expect(after.counts).toEqual(before.counts);
    expect(after.version.updatedAt.toISOString()).toBe(before.version.updatedAt.toISOString());
    expect(after.version.status).toBe(before.version.status);
    expect(canonicalSerialize(after.states)).toBe(canonicalSerialize(before.states));
    expect(canonicalSerialize(after.memberships)).toBe(canonicalSerialize(before.memberships));
    // Explicit field-by-field checks on the rotation cursor, per the
    // review request (currentRound / lockVersion / lastServedMembershipId
    // / carriedForward individually, not just a blob comparison).
    expect(after.states[0]?.currentRound).toBe(before.states[0]?.currentRound);
    expect(after.states[0]?.lockVersion).toBe(before.states[0]?.lockVersion);
    expect(after.states[0]?.lastServedMembershipId).toBe(before.states[0]?.lastServedMembershipId);
    expect(after.states[0]?.carriedForward).toEqual(before.states[0]?.carriedForward);
  }

  it("Phase 7: builds a deterministic Complete Draft Schedule twice from a persisted plan, writes nothing", async () => {
    const { version, pool, baseInput } = await buildPersistedPlan();
    const engineInput: DutyEngineInput = {
      ...baseInput,
      configuredRules: buildCompatibilityRules(baseInput.policy),
      configuredSelectionStrategies: [
        buildV1CompatibilitySelectionStrategy({
          organizationId: baseInput.organizationId,
          regionId: baseInput.regionId,
        }),
      ],
    };

    const before = await snapshotDbState(version.id, pool.id);

    const first = buildDutyEngineContext(engineInput);
    const second = buildDutyEngineContext(engineInput);

    // Byte-identical repeated execution, including the Phase 7 fields.
    expect(canonicalSerialize(second)).toBe(canonicalSerialize(first));
    expect(first.resultFingerprint).toBe(second.resultFingerprint);
    expect(first.completeDraftFingerprint).toBe(second.completeDraftFingerprint);
    expect(canonicalSerialize(first.completeDraftSchedule)).toBe(canonicalSerialize(second.completeDraftSchedule));
    expect(canonicalSerialize(first.draftManifest)).toBe(canonicalSerialize(second.draftManifest));

    // Phase 7 artifact presence and provenance.
    expect(first.completeDraftSchedule).toBeDefined();
    expect(first.completeDraftFingerprint.length).toBeGreaterThan(0);
    expect(first.draftManifest).toBeDefined();
    expect(first.draftManifest.provenance.configurationFingerprint).toBe(first.provenance.configurationFingerprint);
    expect(first.draftManifest.provenance.runtimeInputHash).toBe(first.provenance.runtimeInputHash);
    expect(first.draftManifest.provenance.ruleSetFingerprint).toBe(first.provenance.ruleSetFingerprint);
    expect(first.draftManifest.provenance.strategySetFingerprint).toBe(first.provenance.strategySetFingerprint);
    expect(first.draftManifest.sourceResultFingerprint).toBe(first.resultFingerprint);
    expect(first.draftManifest.planVersionId).toBe(version.id);

    // With 2 candidates and requiredCount=1 across a 7-day period on a
    // pool that starts empty of duty state, expect a fully COMPLETE,
    // commit-eligible draft.
    expect(first.completeDraftSchedule.status).toBe("COMPLETE");
    expect(first.completeDraftSchedule.isCommitEligible).toBe(true);
    expect(first.completeDraftSchedule.diagnostics.filter((d) => d.severity === "ERROR")).toHaveLength(0);
    expect(first.completeDraftSchedule.counts.totalSlots).toBe(7);
    expect(first.completeDraftSchedule.counts.filledSlots).toBe(7);

    const after = await snapshotDbState(version.id, pool.id);
    expectDbUnchanged(before, after);
  });

  it("Phase 7 no-strategy: zero assignments, PARTIAL, DRAFT_NO_SELECTION_STRATEGY, unchanged DB, run twice", async () => {
    const { version, pool, baseInput } = await buildPersistedPlan();
    // Rules configured, but NO selection strategy — the no-strategy
    // contract under test.
    const engineInput: DutyEngineInput = {
      ...baseInput,
      configuredRules: buildCompatibilityRules(baseInput.policy),
      configuredSelectionStrategies: [],
    };

    const before = await snapshotDbState(version.id, pool.id);

    const first = buildDutyEngineContext(engineInput);
    const second = buildDutyEngineContext(engineInput);

    expect(first.provisionalSelections).toHaveLength(0);
    expect(first.completeDraftFingerprint).toBe(second.completeDraftFingerprint);
    expect(canonicalSerialize(first.draftManifest)).toBe(canonicalSerialize(second.draftManifest));

    const draft = first.completeDraftSchedule;
    expect(draft.assignments).toHaveLength(0);
    expect(draft.counts.totalAssignments).toBe(0);
    // Required slots remain explicitly represented, never dropped.
    expect(draft.counts.totalSlots).toBe(7);
    expect(draft.days.flatMap((d) => d.slots)).toHaveLength(7);
    expect(draft.status).toBe("PARTIAL");
    expect(draft.isCommitEligible).toBe(false);
    expect(draft.manifest.status).toBe("PARTIAL");
    expect(draft.manifest.isCommitEligible).toBe(false);
    expect(draft.manifest.unresolvedSlotKeys.length).toBe(7);
    for (const slot of draft.days.flatMap((d) => d.slots)) {
      expect(slot.status).toBe("UNRESOLVED");
      expect(slot.diagnostics.some((d) => d.code === "DRAFT_NO_SELECTION_STRATEGY")).toBe(true);
    }

    const after = await snapshotDbState(version.id, pool.id);
    expectDbUnchanged(before, after);
  });
});
