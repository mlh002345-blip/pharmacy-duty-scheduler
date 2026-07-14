import { afterEach, describe, expect, it } from "vitest";

import { prisma } from "@/lib/prisma";
import { DutyPlanLoaderError } from "@/lib/duty-rules-v2/errors";
import { loadDutyPlanVersion } from "@/lib/duty-rules-v2/load-duty-plan-version";
import { canonicalSerialize } from "@/lib/duty-rules-v2/v1-adapter";
import {
  createTestOrganization,
  createTestPharmacy,
  createTestRegion,
  cleanupTrackedIds,
  newTrackedIds,
  testRunId,
} from "./helpers/fixtures";

// Duty Rules V2 — Phase 3 loader against real PostgreSQL: tenant-scoped
// lookup, cross-tenant detection over the REAL foreign keys the schema
// permits, effective-date membership from persisted dates, insertion-
// order independence, and the read-only (no-write) guarantee.
describe("duty rules v2 loader (real Postgres)", () => {
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

  const DAY_TYPES = [
    "WEEKDAY",
    "SATURDAY",
    "SUNDAY",
    "OFFICIAL_HOLIDAY",
    "RELIGIOUS_HOLIDAY",
    "HOLIDAY_EVE",
  ] as const;

  /** One complete, valid plan-version graph inside a fresh organization. */
  async function createFullGraph(options: { membershipOrder?: "forward" | "reverse" } = {}) {
    const organization = await createTestOrganization(tracked);
    const region = await createTestRegion(tracked, { organizationId: organization.id });
    const pharmacyA = await createTestPharmacy(tracked, region.id);
    const pharmacyB = await createTestPharmacy(tracked, region.id);
    const inactivePharmacy = await createTestPharmacy(tracked, region.id, { isActive: false });

    const plan = await prisma.dutyPlan.create({
      data: { name: `Plan ${testRunId()}`, organizationId: organization.id, regionId: region.id },
    });
    v2.planIds.push(plan.id);
    const version = await prisma.dutyPlanVersion.create({
      data: {
        planId: plan.id,
        versionNumber: 1,
        status: "APPROVED",
        validFrom: new Date("2026-08-01T00:00:00.000Z"),
      },
    });
    const shift = await prisma.shiftDefinition.create({
      data: {
        planVersionId: version.id,
        name: "Tam Gün",
        startMinute: 0,
        endMinute: 0,
        spansMidnight: false,
      },
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

    const membershipRows = [
      { pharmacyId: pharmacyA.id, joinedAt: new Date("2026-01-01T00:00:00.000Z"), leftAt: null },
      {
        pharmacyId: pharmacyB.id,
        joinedAt: new Date("2026-01-01T00:00:00.000Z"),
        leftAt: new Date("2026-08-15T00:00:00.000Z"),
      },
      {
        pharmacyId: inactivePharmacy.id,
        joinedAt: new Date("2026-01-01T00:00:00.000Z"),
        leftAt: null,
      },
    ];
    if (options.membershipOrder === "reverse") membershipRows.reverse();
    for (const row of membershipRows) {
      await prisma.rotationPoolMembership.create({ data: { poolId: pool.id, ...row } });
    }
    await prisma.rotationState.create({
      data: { poolId: pool.id, dayTypeScope: "ALL" },
    });

    const dayTypeRows = [...DAY_TYPES];
    if (options.membershipOrder === "reverse") dayTypeRows.reverse();
    for (const dayType of dayTypeRows) {
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

    return { organization, region, plan, version, shift, pool, pharmacyA, pharmacyB, inactivePharmacy };
  }

  it("loads a valid version tenant-scoped, with persisted-date membership resolution", async () => {
    const graph = await createFullGraph();
    const loaded = await loadDutyPlanVersion({
      organizationId: graph.organization.id,
      regionId: graph.region.id,
      planVersionId: graph.version.id,
      effectiveDate: "2026-08-15",
    });

    expect(loaded.planVersionId).toBe(graph.version.id);
    expect(loaded.organizationId).toBe(graph.organization.id);
    expect(loaded.status).toBe("APPROVED");
    expect(loaded.dayTypeRules.map((r) => r.dayType)).toEqual([...DAY_TYPES]);
    expect(loaded.slotRequirements).toHaveLength(6);
    expect(loaded.rotationPools).toHaveLength(1);

    // Persisted dates drive the snapshot: A eligible; B left exactly on
    // the effective date (EXCLUSIVE => excluded); inactive excluded.
    const snapshot = loaded.membershipSnapshots?.[0];
    expect(snapshot?.eligible.map((e) => e.pharmacyId)).toEqual([graph.pharmacyA.id]);
    const reasons = new Map(snapshot?.excluded.map((e) => [e.pharmacyId, e.reason]));
    expect(reasons.get(graph.pharmacyB.id)).toBe("LEFT_BEFORE_EFFECTIVE_DATE");
    expect(reasons.get(graph.inactivePharmacy.id)).toBe("PHARMACY_INACTIVE");
    // One day earlier, B is still a member.
    const dayBefore = await loadDutyPlanVersion({
      organizationId: graph.organization.id,
      regionId: graph.region.id,
      planVersionId: graph.version.id,
      effectiveDate: "2026-08-14",
    });
    expect(dayBefore.membershipSnapshots?.[0].eligible.map((e) => e.pharmacyId).sort()).toEqual(
      [graph.pharmacyA.id, graph.pharmacyB.id].sort()
    );
  });

  it("returns the same generic not-found for foreign-organization and foreign-region lookups", async () => {
    const graph = await createFullGraph();
    const otherOrganization = await createTestOrganization(tracked);
    const otherRegion = await createTestRegion(tracked, {
      organizationId: graph.organization.id,
    });

    const attempts = [
      // Version exists, requested from another organization.
      {
        organizationId: otherOrganization.id,
        regionId: graph.region.id,
        planVersionId: graph.version.id,
      },
      // Version exists, requested for another region of the SAME organization.
      {
        organizationId: graph.organization.id,
        regionId: otherRegion.id,
        planVersionId: graph.version.id,
      },
      // Version genuinely does not exist.
      {
        organizationId: graph.organization.id,
        regionId: graph.region.id,
        planVersionId: "pv-does-not-exist",
      },
    ];
    const errors: DutyPlanLoaderError[] = [];
    for (const attempt of attempts) {
      const error = await loadDutyPlanVersion(attempt).then(
        () => null,
        (e: unknown) => e as DutyPlanLoaderError
      );
      expect(error).toBeInstanceOf(DutyPlanLoaderError);
      if (error) errors.push(error);
    }
    expect(errors.map((e) => e.code)).toEqual([
      "PLAN_VERSION_NOT_FOUND",
      "PLAN_VERSION_NOT_FOUND",
      "PLAN_VERSION_NOT_FOUND",
    ]);
    expect(new Set(errors.map((e) => e.message)).size).toBe(1);
  });

  it("detects a REAL cross-tenant slot → pool reference the database permits", async () => {
    const graph = await createFullGraph();
    const foreign = await createFullGraph();

    // The DB accepts this foreign-organization pool on org A's slot —
    // exactly the gap the loader must close in the service layer.
    const weekdayRule = await prisma.dayTypeRule.findFirstOrThrow({
      where: { planVersionId: graph.version.id, dayType: "WEEKDAY" },
      include: { slotRequirements: true },
    });
    await prisma.slotRequirement.update({
      where: { id: weekdayRule.slotRequirements[0].id },
      data: { rotationPoolId: foreign.pool.id },
    });

    const error = await loadDutyPlanVersion({
      organizationId: graph.organization.id,
      regionId: graph.region.id,
      planVersionId: graph.version.id,
    }).then(
      () => null,
      (e: unknown) => e as DutyPlanLoaderError
    );
    expect(error?.code).toBe("TENANT_INTEGRITY_VIOLATION");
    expect(error?.issues.map((i) => i.code)).toContain("POOL_ORGANIZATION_MISMATCH");
    // Ids only, never tenant content.
    expect(error?.message).not.toContain(foreign.pool.name);
  });

  it("detects a REAL cross-tenant membership → pharmacy reference the database permits", async () => {
    const graph = await createFullGraph();
    const foreign = await createFullGraph();

    await prisma.rotationPoolMembership.create({
      data: {
        poolId: graph.pool.id,
        pharmacyId: foreign.pharmacyA.id, // other organization's pharmacy
        joinedAt: new Date("2026-01-01T00:00:00.000Z"),
      },
    });

    const error = await loadDutyPlanVersion({
      organizationId: graph.organization.id,
      regionId: graph.region.id,
      planVersionId: graph.version.id,
    }).then(
      () => null,
      (e: unknown) => e as DutyPlanLoaderError
    );
    expect(error?.code).toBe("TENANT_INTEGRITY_VIOLATION");
    expect(error?.issues.map((i) => i.code)).toContain(
      "MEMBERSHIP_PHARMACY_ORGANIZATION_MISMATCH"
    );
    expect(error?.message).not.toContain(foreign.pharmacyA.name);
  });

  it("normalized output is byte-identical across repeated loads, and the fingerprint is insertion-order independent", async () => {
    const graph = await createFullGraph();
    const first = await loadDutyPlanVersion({
      organizationId: graph.organization.id,
      regionId: graph.region.id,
      planVersionId: graph.version.id,
      effectiveDate: "2026-08-15",
    });
    const second = await loadDutyPlanVersion({
      organizationId: graph.organization.id,
      regionId: graph.region.id,
      planVersionId: graph.version.id,
      effectiveDate: "2026-08-15",
    });
    expect(canonicalSerialize(second)).toBe(canonicalSerialize(first));

    // A SECOND version under the same plan with the same configuration,
    // its children inserted in REVERSE order: row ids and insertion order
    // differ, configuration does not — the fingerprint must be equal
    // (it is built from natural keys, never generated row ids).
    const version2 = await prisma.dutyPlanVersion.create({
      data: {
        planId: graph.plan.id,
        versionNumber: 2,
        status: "DRAFT",
        validFrom: new Date("2026-08-01T00:00:00.000Z"),
      },
    });
    const shift2 = await prisma.shiftDefinition.create({
      data: {
        planVersionId: version2.id,
        name: "Tam Gün",
        startMinute: 0,
        endMinute: 0,
        spansMidnight: false,
      },
    });
    for (const dayType of [...DAY_TYPES].reverse()) {
      const rule = await prisma.dayTypeRule.create({
        data: { planVersionId: version2.id, dayType, isServed: true },
      });
      await prisma.slotRequirement.create({
        data: {
          dayTypeRuleId: rule.id,
          shiftDefinitionId: shift2.id,
          rotationPoolId: graph.pool.id,
          requiredCount: 1,
        },
      });
    }
    const loadedVersion2 = await loadDutyPlanVersion({
      organizationId: graph.organization.id,
      regionId: graph.region.id,
      planVersionId: version2.id,
    });
    expect(loadedVersion2.configurationFingerprint).toBe(first.configurationFingerprint);
  });

  it("changes nothing in the database (row counts and updatedAt values are identical)", async () => {
    const graph = await createFullGraph();

    async function snapshotState() {
      const [version, dayTypeRules, shifts, slots, pool, memberships, states] = await Promise.all(
        [
          prisma.dutyPlanVersion.findUniqueOrThrow({ where: { id: graph.version.id } }),
          prisma.dayTypeRule.findMany({
            where: { planVersionId: graph.version.id },
            orderBy: { id: "asc" },
          }),
          prisma.shiftDefinition.findMany({
            where: { planVersionId: graph.version.id },
            orderBy: { id: "asc" },
          }),
          prisma.slotRequirement.count({
            where: { dayTypeRule: { planVersionId: graph.version.id } },
          }),
          prisma.rotationPool.findUniqueOrThrow({ where: { id: graph.pool.id } }),
          prisma.rotationPoolMembership.findMany({
            where: { poolId: graph.pool.id },
            orderBy: { id: "asc" },
          }),
          prisma.rotationState.findMany({
            where: { poolId: graph.pool.id },
            orderBy: { id: "asc" },
          }),
        ]
      );
      return JSON.stringify({
        version: { ...version, updatedAt: version.updatedAt.toISOString() },
        dayTypeRules: dayTypeRules.map((r) => ({ id: r.id, updatedAt: r.updatedAt.toISOString() })),
        shifts: shifts.map((s) => ({ id: s.id, updatedAt: s.updatedAt.toISOString() })),
        slotCount: slots,
        pool: { ...pool, updatedAt: pool.updatedAt.toISOString() },
        memberships: memberships.map((m) => ({ id: m.id, updatedAt: m.updatedAt.toISOString() })),
        states: states.map((s) => ({
          id: s.id,
          lockVersion: s.lockVersion,
          currentRound: s.currentRound,
          updatedAt: s.updatedAt.toISOString(),
        })),
      });
    }

    const before = await snapshotState();
    await loadDutyPlanVersion({
      organizationId: graph.organization.id,
      regionId: graph.region.id,
      planVersionId: graph.version.id,
      effectiveDate: "2026-08-15",
    });
    const after = await snapshotState();
    expect(after).toBe(before);
  });
});
