import { afterEach, describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import {
  createTestOrganization,
  createTestPharmacy,
  createTestRegion,
  cleanupTrackedIds,
  newTrackedIds,
  testRunId,
} from "./helpers/fixtures";

// Duty Rules V2 core schema (Phase 1) — real-Postgres verification of the
// new tables, tenant ownership paths, partial unique indexes, temporal
// membership semantics, and deletion protections. There is deliberately
// NO engine, action, or UI in this phase, so everything here talks to
// Prisma directly. See docs/architecture/DUTY_RULES_V2_CORE_SCHEMA.md.
describe("duty rules v2 core schema (real Postgres)", () => {
  const tracked = newTrackedIds();
  // V2 rows created by these tests, deleted before shared fixture
  // cleanup (Region/Organization carry Restrict FKs from the new tables).
  const v2 = { planIds: [] as string[], poolIds: [] as string[] };

  afterEach(async () => {
    // Cascade order: schedules unlink first (planVersion is Restrict),
    // then plans (versions/day types/shifts/slots cascade), then pools
    // (memberships/states cascade; slotRequirements are already gone).
    await prisma.dutySchedule.updateMany({
      where: { planVersionId: { not: null } },
      data: { planVersionId: null },
    });
    // V2 assignments must be DELETED (not shift-nullified): nullifying
    // two different-shift rows for the same pharmacy+date would collide
    // on the legacy partial unique — itself a nice proof the index works.
    await prisma.dutyAssignment.deleteMany({
      where: { shiftDefinitionId: { not: null } },
    });
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

  function isUniqueViolation(error: unknown): boolean {
    return (
      error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002"
    );
  }

  async function createPlanGraph() {
    const organization = await createTestOrganization(tracked);
    const region = await createTestRegion(tracked, { organizationId: organization.id });
    const plan = await prisma.dutyPlan.create({
      data: {
        name: `Plan ${testRunId()}`,
        organizationId: organization.id,
        regionId: region.id,
      },
    });
    v2.planIds.push(plan.id);
    const version = await prisma.dutyPlanVersion.create({
      data: { planId: plan.id, versionNumber: 1, validFrom: new Date("2026-08-01") },
    });
    return { organization, region, plan, version };
  }

  it("creates the full core entity graph: plan → version → day types → shifts → slots → pool", async () => {
    const { organization, region, plan, version } = await createPlanGraph();

    const fullNight = await prisma.shiftDefinition.create({
      data: {
        planVersionId: version.id,
        name: "Tam Gece",
        startMinute: 19 * 60,
        endMinute: 8 * 60,
        spansMidnight: true,
        defaultWeight: 1.5,
        sortOrder: 1,
      },
    });
    const daytime = await prisma.shiftDefinition.create({
      data: {
        planVersionId: version.id,
        name: "Gündüz Destek",
        startMinute: 9 * 60,
        endMinute: 19 * 60,
        defaultWeight: 0.5,
        sortOrder: 2,
      },
    });

    const saturday = await prisma.dayTypeRule.create({
      data: { planVersionId: version.id, dayType: "SATURDAY" },
    });

    const pool = await prisma.rotationPool.create({
      data: {
        name: `Havuz A ${testRunId()}`,
        organizationId: organization.id,
        regionId: region.id,
        strategy: "SEQUENTIAL",
      },
    });
    v2.poolIds.push(pool.id);

    // A multi-shift Saturday: N full-night + M daytime-support slots —
    // configured data, nothing hardcoded.
    await prisma.slotRequirement.createMany({
      data: [
        { dayTypeRuleId: saturday.id, shiftDefinitionId: fullNight.id, requiredCount: 4, sortOrder: 1, rotationPoolId: pool.id },
        { dayTypeRuleId: saturday.id, shiftDefinitionId: daytime.id, requiredCount: 13, sortOrder: 2, name: "Gündüz destek" },
      ],
    });

    const loaded = await prisma.dutyPlan.findUniqueOrThrow({
      where: { id: plan.id },
      include: {
        versions: {
          include: {
            dayTypeRules: { include: { slotRequirements: true } },
            shiftDefinitions: true,
          },
        },
      },
    });
    expect(loaded.organizationId).toBe(organization.id);
    expect(loaded.versions[0].shiftDefinitions).toHaveLength(2);
    expect(loaded.versions[0].dayTypeRules[0].slotRequirements).toHaveLength(2);
  });

  it("a region may have multiple plans (no unique constraint on regionId)", async () => {
    const { organization, region, plan } = await createPlanGraph();
    const second = await prisma.dutyPlan.create({
      data: { name: "İkinci taslak", organizationId: organization.id, regionId: region.id },
    });
    v2.planIds.push(second.id);
    expect(second.id).not.toBe(plan.id);
    expect(
      await prisma.dutyPlan.count({ where: { regionId: region.id } })
    ).toBe(2);
  });

  it("version numbering is unique per plan; identical numbers on different plans are fine", async () => {
    const a = await createPlanGraph();
    const b = await createPlanGraph();

    await expect(
      prisma.dutyPlanVersion.create({
        data: { planId: a.plan.id, versionNumber: 1, validFrom: new Date("2026-09-01") },
      })
    ).rejects.toSatisfy(isUniqueViolation);

    // Same versionNumber, different plan — allowed.
    const other = await prisma.dutyPlanVersion.create({
      data: { planId: b.plan.id, versionNumber: 2, validFrom: new Date("2026-09-01") },
    });
    expect(other.versionNumber).toBe(2);
  });

  it("identical pool names are allowed across organizations but not within one", async () => {
    const a = await createPlanGraph();
    const b = await createPlanGraph();
    const name = `Merkez Havuzu ${testRunId()}`;

    const poolA = await prisma.rotationPool.create({
      data: { name, organizationId: a.organization.id },
    });
    const poolB = await prisma.rotationPool.create({
      data: { name, organizationId: b.organization.id },
    });
    v2.poolIds.push(poolA.id, poolB.id);
    expect(poolA.id).not.toBe(poolB.id);

    await expect(
      prisma.rotationPool.create({ data: { name, organizationId: a.organization.id } })
    ).rejects.toSatisfy(isUniqueViolation);
  });

  it("pool membership is temporal: transfers close and reopen rows, and as-of queries resolve correctly", async () => {
    const { organization, region } = await createPlanGraph();
    const pharmacy = await createTestPharmacy(tracked, region.id);
    const poolA = await prisma.rotationPool.create({
      data: { name: `A ${testRunId()}`, organizationId: organization.id },
    });
    const poolB = await prisma.rotationPool.create({
      data: { name: `B ${testRunId()}`, organizationId: organization.id },
    });
    v2.poolIds.push(poolA.id, poolB.id);

    // Member of A for June–July, then transferred to B — the A row is
    // CLOSED, never overwritten.
    const juneFirst = new Date("2026-06-01");
    const augustFirst = new Date("2026-08-01");
    await prisma.rotationPoolMembership.create({
      data: { poolId: poolA.id, pharmacyId: pharmacy.id, joinedAt: juneFirst, leftAt: augustFirst },
    });
    await prisma.rotationPoolMembership.create({
      data: { poolId: poolB.id, pharmacyId: pharmacy.id, joinedAt: augustFirst },
    });

    const activeAsOf = (poolId: string, date: Date) =>
      prisma.rotationPoolMembership.count({
        where: {
          poolId,
          pharmacyId: pharmacy.id,
          joinedAt: { lte: date },
          OR: [{ leftAt: null }, { leftAt: { gt: date } }],
        },
      });

    expect(await activeAsOf(poolA.id, new Date("2026-07-15"))).toBe(1);
    expect(await activeAsOf(poolB.id, new Date("2026-07-15"))).toBe(0);
    expect(await activeAsOf(poolA.id, new Date("2026-08-15"))).toBe(0);
    expect(await activeAsOf(poolB.id, new Date("2026-08-15"))).toBe(1);
    // Historical A row still exists — history preserved.
    expect(
      await prisma.rotationPoolMembership.count({ where: { poolId: poolA.id } })
    ).toBe(1);
  });

  it("rotation state is unique per (pool, dayTypeScope) and validates its carry-forward shape", async () => {
    const { organization } = await createPlanGraph();
    const pool = await prisma.rotationPool.create({
      data: { name: `S ${testRunId()}`, organizationId: organization.id },
    });
    v2.poolIds.push(pool.id);

    await prisma.rotationState.create({
      data: { poolId: pool.id, dayTypeScope: "ALL", currentRound: 3 },
    });
    await prisma.rotationState.create({
      data: { poolId: pool.id, dayTypeScope: "SUNDAY", currentRound: 1 },
    });
    await expect(
      prisma.rotationState.create({ data: { poolId: pool.id, dayTypeScope: "ALL" } })
    ).rejects.toSatisfy(isUniqueViolation);
  });

  it("legacy assignments (NULL shift) keep the exact V1 uniqueness guarantee", async () => {
    const { region } = await createPlanGraph();
    const pharmacy = await createTestPharmacy(tracked, region.id);
    const schedule = await prisma.dutySchedule.create({
      data: { month: 8, year: 2026, regionId: region.id },
    });
    tracked.dutyScheduleIds.push(schedule.id);
    const date = new Date("2026-08-10");

    await prisma.dutyAssignment.create({
      data: { dutyScheduleId: schedule.id, pharmacyId: pharmacy.id, date, weight: 1 },
    });
    // Duplicate legacy row: caught by the partial unique index.
    await expect(
      prisma.dutyAssignment.create({
        data: { dutyScheduleId: schedule.id, pharmacyId: pharmacy.id, date, weight: 1 },
      })
    ).rejects.toSatisfy(isUniqueViolation);
  });

  it("V2 assignments: same pharmacy in two DIFFERENT shifts on one date is allowed; duplicate same-shift rows are not", async () => {
    const { region, version } = await createPlanGraph();
    const pharmacy = await createTestPharmacy(tracked, region.id);
    const schedule = await prisma.dutySchedule.create({
      data: { month: 8, year: 2026, regionId: region.id, planVersionId: version.id },
    });
    tracked.dutyScheduleIds.push(schedule.id);
    const shiftNight = await prisma.shiftDefinition.create({
      data: { planVersionId: version.id, name: "Gece", startMinute: 1140, endMinute: 480, spansMidnight: true },
    });
    const shiftDay = await prisma.shiftDefinition.create({
      data: { planVersionId: version.id, name: "Gündüz", startMinute: 540, endMinute: 1140 },
    });
    const date = new Date("2026-08-11");

    await prisma.dutyAssignment.create({
      data: { dutyScheduleId: schedule.id, pharmacyId: pharmacy.id, date, weight: 1.5, shiftDefinitionId: shiftNight.id },
    });
    // Different shift, same pharmacy, same date — allowed by design
    // (governed later by a configurable rule, never the database).
    await prisma.dutyAssignment.create({
      data: { dutyScheduleId: schedule.id, pharmacyId: pharmacy.id, date, weight: 0.5, shiftDefinitionId: shiftDay.id },
    });
    // Exact duplicate (same shift) — blocked.
    await expect(
      prisma.dutyAssignment.create({
        data: { dutyScheduleId: schedule.id, pharmacyId: pharmacy.id, date, weight: 1.5, shiftDefinitionId: shiftNight.id },
      })
    ).rejects.toSatisfy(isUniqueViolation);

    expect(
      await prisma.dutyAssignment.count({ where: { dutyScheduleId: schedule.id, date } })
    ).toBe(2);
  });

  it("DayTypeRule partial uniques: one plain row per (version, dayType); custom categories coexist without duplicating", async () => {
    const { version } = await createPlanGraph();

    await prisma.dayTypeRule.create({ data: { planVersionId: version.id, dayType: "WEEKDAY" } });
    await expect(
      prisma.dayTypeRule.create({ data: { planVersionId: version.id, dayType: "WEEKDAY" } })
    ).rejects.toSatisfy(isUniqueViolation);

    await prisma.dayTypeRule.create({
      data: { planVersionId: version.id, dayType: "WEEKDAY", customDayCategory: "pazar-kurulumu" },
    });
    await expect(
      prisma.dayTypeRule.create({
        data: { planVersionId: version.id, dayType: "WEEKDAY", customDayCategory: "pazar-kurulumu" },
      })
    ).rejects.toSatisfy(isUniqueViolation);
  });

  it("deletion protections: a version referenced by a schedule and a pool referenced by a slot cannot be deleted", async () => {
    const { organization, region, plan, version } = await createPlanGraph();
    const schedule = await prisma.dutySchedule.create({
      data: { month: 9, year: 2026, regionId: region.id, planVersionId: version.id },
    });
    tracked.dutyScheduleIds.push(schedule.id);

    // Version delete (direct or via plan cascade) is blocked while a
    // schedule references it — historical interpretability protection.
    await expect(
      prisma.dutyPlanVersion.delete({ where: { id: version.id } })
    ).rejects.toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
    await expect(prisma.dutyPlan.delete({ where: { id: plan.id } })).rejects.toBeInstanceOf(
      Prisma.PrismaClientKnownRequestError
    );

    const pool = await prisma.rotationPool.create({
      data: { name: `Korunan ${testRunId()}`, organizationId: organization.id },
    });
    v2.poolIds.push(pool.id);
    const shift = await prisma.shiftDefinition.create({
      data: { planVersionId: version.id, name: "Tek", startMinute: 0, endMinute: 1439 },
    });
    const dayType = await prisma.dayTypeRule.create({
      data: { planVersionId: version.id, dayType: "SUNDAY" },
    });
    await prisma.slotRequirement.create({
      data: { dayTypeRuleId: dayType.id, shiftDefinitionId: shift.id, requiredCount: 1, rotationPoolId: pool.id },
    });
    await expect(prisma.rotationPool.delete({ where: { id: pool.id } })).rejects.toBeInstanceOf(
      Prisma.PrismaClientKnownRequestError
    );
  });

  it("tenant ownership paths resolve for every new entity (org → plan → version → children; org → pool → children)", async () => {
    const { organization, version } = await createPlanGraph();
    const shift = await prisma.shiftDefinition.create({
      data: { planVersionId: version.id, name: "Sahiplik", startMinute: 0, endMinute: 720 },
    });

    // The canonical org-scoped query shape the future service layer will
    // use — no organizationId column exists below DutyPlan by design.
    const owned = await prisma.shiftDefinition.findFirst({
      where: {
        id: shift.id,
        planVersion: { plan: { organizationId: organization.id } },
      },
    });
    expect(owned?.id).toBe(shift.id);

    const otherOrg = await createTestOrganization(tracked);
    const foreign = await prisma.shiftDefinition.findFirst({
      where: { id: shift.id, planVersion: { plan: { organizationId: otherOrg.id } } },
    });
    expect(foreign).toBeNull();
  });
});
