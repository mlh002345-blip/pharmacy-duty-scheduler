import { afterEach, describe, expect, it } from "vitest";

import { prisma } from "@/lib/prisma";
import { loadDutyPlanVersion } from "@/lib/duty-rules-v2/load-duty-plan-version";
import { buildDutyEngineContext } from "@/lib/duty-rules-v2/engine/build-engine-context";
import { ruleSetFingerprint } from "@/lib/duty-rules-v2/rules/canonicalize-rule-set";
import type { ConfiguredRuleDefinition } from "@/lib/duty-rules-v2/rules/domain/rule-definition";
import type { DutyEngineInput } from "@/lib/duty-rules-v2/engine/domain/engine-input";
import { canonicalSerialize } from "@/lib/duty-rules-v2/v1-adapter";
import {
  createTestOrganization,
  createTestPharmacy,
  createTestRegion,
  cleanupTrackedIds,
  newTrackedIds,
  testRunId,
} from "./helpers/fixtures";

// Duty Rules V2 — Phase 5 optional integration: persisted plan → Phase 3
// loader → pure engine with in-memory configured rules. Deterministic
// SelectionInput with rule results + fingerprint; zero writes; no
// schedule or assignment is ever created; no rule is persisted.
describe("duty rules v2 configurable rule engine from a persisted plan (real Postgres)", () => {
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

  it("evaluates in-memory rules over a loaded persisted plan without writing anything", async () => {
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
    for (const pharmacy of [pharmacyA, pharmacyB]) {
      await prisma.rotationPoolMembership.create({
        data: { poolId: pool.id, pharmacyId: pharmacy.id, joinedAt: new Date("2026-01-01T00:00:00.000Z") },
      });
    }
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

    const configuredRules: ConfiguredRuleDefinition[] = [
      {
        id: "cfg-exclude-a",
        ruleType: "EXCLUDE_PHARMACY",
        name: "Test dışlama",
        enabled: true,
        severity: "HARD",
        priority: 10,
        scope: { poolIds: [pool.id] },
        parameters: { pharmacyIds: [pharmacyA.id] },
        validFrom: null,
        validTo: null,
        exceptions: {},
        source: "ORGANIZATION_CONFIGURED",
        version: 1,
        metadata: {},
      },
    ];

    const engineInput: DutyEngineInput = {
      loadedPlan: loaded,
      organizationId: organization.id,
      regionId: region.id,
      periodStart: "2026-08-03",
      periodEnd: "2026-08-05",
      generationMode: "PREVIEW",
      policy: {
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
      },
      holidays: [],
      customDayOverrides: [],
      unavailability: [],
      dutyRequests: [],
      historicalDuties: [],
      balanceAdjustments: [],
      existingAssignments: [],
      configuredRules,
    };

    const countsBefore = {
      schedules: await prisma.dutySchedule.count(),
      assignments: await prisma.dutyAssignment.count(),
      states: await prisma.rotationState.count(),
      versions: await prisma.dutyPlanVersion.count(),
    };
    const versionBefore = await prisma.dutyPlanVersion.findUniqueOrThrow({
      where: { id: version.id },
    });

    const first = buildDutyEngineContext(engineInput);
    const second = buildDutyEngineContext(engineInput);
    expect(canonicalSerialize(second)).toBe(canonicalSerialize(first));

    // Rule results + fingerprint in SelectionInput; the excluded
    // pharmacy is out of strict eligibility on every date.
    expect(first.provenance.ruleSetFingerprint).toBe(ruleSetFingerprint(configuredRules));
    for (const selection of first.selectionInputs) {
      expect(selection.provenance.ruleSetFingerprint).toBe(first.provenance.ruleSetFingerprint);
      expect(selection.ruleEvaluations.length).toBeGreaterThan(0);
      expect(selection.relaxation.strictEligible).toHaveLength(1);
    }

    const countsAfter = {
      schedules: await prisma.dutySchedule.count(),
      assignments: await prisma.dutyAssignment.count(),
      states: await prisma.rotationState.count(),
      versions: await prisma.dutyPlanVersion.count(),
    };
    expect(countsAfter).toEqual(countsBefore);
    const versionAfter = await prisma.dutyPlanVersion.findUniqueOrThrow({
      where: { id: version.id },
    });
    expect(versionAfter.updatedAt.toISOString()).toBe(versionBefore.updatedAt.toISOString());
  });
});
