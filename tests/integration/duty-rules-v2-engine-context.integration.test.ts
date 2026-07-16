import { afterEach, describe, expect, it } from "vitest";

import { prisma } from "@/lib/prisma";
import { loadDutyPlanVersion } from "@/lib/duty-rules-v2/load-duty-plan-version";
import { buildDutyEngineContext } from "@/lib/duty-rules-v2/engine/build-engine-context";
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

// Duty Rules V2 — Phase 4 optional integration: a REAL persisted plan is
// loaded through the Phase 3 loader and fed into the pure engine context
// builder. Deterministic draft output, zero writes. No schedule or
// assignment is ever created.
describe("duty rules v2 engine context from a persisted plan (real Postgres)", () => {
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

  it("loads, builds a deterministic draft context twice, and writes nothing", async () => {
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

    const engineInput: DutyEngineInput = {
      loadedPlan: loaded,
      organizationId: organization.id,
      regionId: region.id,
      periodStart: "2026-08-03",
      periodEnd: "2026-08-09",
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
    };

    const countsBefore = {
      schedules: await prisma.dutySchedule.count(),
      assignments: await prisma.dutyAssignment.count(),
      versions: await prisma.dutyPlanVersion.count(),
      states: await prisma.rotationState.count(),
    };
    const versionBefore = await prisma.dutyPlanVersion.findUniqueOrThrow({
      where: { id: version.id },
    });

    const first = buildDutyEngineContext(engineInput);
    const second = buildDutyEngineContext(engineInput);

    expect(canonicalSerialize(second)).toBe(canonicalSerialize(first));
    expect(first.resultFingerprint).toBe(second.resultFingerprint);
    expect(first.days).toHaveLength(7);
    expect(first.selectionInputs).toHaveLength(7);
    expect(first.counts.candidates).toBe(14); // 2 candidates × 7 dates
    expect(first.provenance.configurationFingerprint).toBe(loaded.configurationFingerprint);
    expect(first.provenance.planVersionId).toBe(version.id);

    const countsAfter = {
      schedules: await prisma.dutySchedule.count(),
      assignments: await prisma.dutyAssignment.count(),
      versions: await prisma.dutyPlanVersion.count(),
      states: await prisma.rotationState.count(),
    };
    expect(countsAfter).toEqual(countsBefore);
    const versionAfter = await prisma.dutyPlanVersion.findUniqueOrThrow({
      where: { id: version.id },
    });
    expect(versionAfter.updatedAt.toISOString()).toBe(versionBefore.updatedAt.toISOString());
    expect(versionAfter.status).toBe("ACTIVE"); // untouched, not re-activated
  });
});
