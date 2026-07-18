// Duty Rules V2 — Phase 11: plan configuration services, against a real
// Postgres database. Configures each real-world roster shape purely
// through the new services in src/lib/duty-rules-v2/configuration/ (never
// raw Prisma inserts for day-type-rules/shifts/slots/pools/memberships),
// then proves the configuration is genuinely usable via
// loadDutyPlanVersion and (for Vakfıkebir/Akçaabat) the full Phase 4-7
// generation pipeline. Follows
// duty-rules-v2-atomic-draft-persistence.integration.test.ts's fixture/
// cleanup style.

import { afterEach, describe, expect, it } from "vitest";

import { prisma } from "@/lib/prisma";
import { loadDutyPlanVersion } from "@/lib/duty-rules-v2/load-duty-plan-version";
import { buildDutyEngineContext } from "@/lib/duty-rules-v2/engine/build-engine-context";
import { assembleV1CompatibilityEngineInput } from "@/lib/duty-rules-v2/ui/assemble-v1-compatibility-engine-input";
import type { BuiltinDayType } from "@/lib/duty-rules-v2/domain/loaded-plan";

import { createDutyPlan } from "@/lib/duty-rules-v2/configuration/create-duty-plan";
import { createPlanVersion } from "@/lib/duty-rules-v2/configuration/create-plan-version";
import { setDayTypeRules } from "@/lib/duty-rules-v2/configuration/update-day-type-rules";
import { setShiftDefinitions } from "@/lib/duty-rules-v2/configuration/update-shift-definitions";
import { setSlotRequirements } from "@/lib/duty-rules-v2/configuration/update-slot-requirements";
import { createRotationPool } from "@/lib/duty-rules-v2/configuration/create-rotation-pool";
import { addPoolMembership } from "@/lib/duty-rules-v2/configuration/update-pool-membership";
import { checkPlanVersionActivationReadiness } from "@/lib/duty-rules-v2/configuration/validate-plan-version-completeness";
import { activatePlanVersion } from "@/lib/duty-rules-v2/configuration/activate-plan-version";

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

const ALL_DAY_TYPES: BuiltinDayType[] = [
  "WEEKDAY",
  "SATURDAY",
  "SUNDAY",
  "OFFICIAL_HOLIDAY",
  "RELIGIOUS_HOLIDAY",
  "HOLIDAY_EVE",
];

describe("Duty Rules V2 Phase 11 — plan configuration services (real Postgres)", () => {
  const tracked = newTrackedIds();
  const cleanupIds = { planIds: [] as string[], poolIds: [] as string[], scheduleIds: [] as string[] };

  afterEach(async () => {
    if (cleanupIds.scheduleIds.length > 0) {
      await prisma.dutyAssignment.deleteMany({ where: { dutyScheduleId: { in: cleanupIds.scheduleIds } } });
      await prisma.auditLog.deleteMany({ where: { entity: "DutySchedule", entityId: { in: cleanupIds.scheduleIds } } });
      await prisma.dutySchedule.deleteMany({ where: { id: { in: cleanupIds.scheduleIds } } });
      cleanupIds.scheduleIds.length = 0;
    }
    // AuditLog rows written by the configuration services themselves
    // (DutyPlan/DutyPlanVersion/RotationPool/RotationPoolMembership
    // entities) reference organizationId (Restrict) — deleted before
    // organizations below via cleanupTrackedIds' own AuditLog step, but
    // plan/pool-scoped audit rows use entity ids this suite tracks
    // separately, not covered by that step, so they're deleted here.
    if (cleanupIds.planIds.length > 0) {
      await prisma.auditLog.deleteMany({
        where: { OR: [{ entity: "DutyPlan", entityId: { in: cleanupIds.planIds } }] },
      });
      await prisma.auditLog.deleteMany({ where: { entity: "DutyPlanVersion" } }).catch(() => {});
      await prisma.dutyPlan.deleteMany({ where: { id: { in: cleanupIds.planIds } } });
      cleanupIds.planIds.length = 0;
    }
    if (cleanupIds.poolIds.length > 0) {
      await prisma.auditLog.deleteMany({
        where: { OR: [{ entity: "RotationPool", entityId: { in: cleanupIds.poolIds } }] },
      });
      await prisma.rotationPool.deleteMany({ where: { id: { in: cleanupIds.poolIds } } });
      cleanupIds.poolIds.length = 0;
    }
    await cleanupTrackedIds(tracked);
  });

  async function setupOrgRegion(pharmacyCount = 3) {
    const organization = await createTestOrganization(tracked);
    const region = await createTestRegion(tracked, { organizationId: organization.id });
    const user = await createTestUser(tracked, { organizationId: organization.id, role: "ADMIN" });
    const pharmacies = [];
    for (let i = 0; i < pharmacyCount; i++) {
      pharmacies.push(await createTestPharmacy(tracked, region.id));
    }
    return { organization, region, user, pharmacies };
  }

  async function createPoolWithMembers(
    organizationId: string,
    regionId: string,
    userId: string,
    pharmacyIds: string[],
    name: string
  ) {
    const created = await createRotationPool({
      organizationId,
      regionId,
      name,
      strategy: "FAIRNESS_SCORE",
      userId,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) throw new Error("pool creation failed");
    cleanupIds.poolIds.push(created.poolId);
    for (const pharmacyId of pharmacyIds) {
      const added = await addPoolMembership({
        organizationId,
        poolId: created.poolId,
        pharmacyId,
        joinedAt: "2026-01-01",
        userId,
      });
      expect(added.ok).toBe(true);
    }
    return created.poolId;
  }

  // -------------------------------------------------------------------
  // Pelitli modeli
  // -------------------------------------------------------------------
  it("Pelitli modeli: yalnızca Cumartesi + ayrı bayram havuzu", async () => {
    const { organization, region, user, pharmacies } = await setupOrgRegion(6);

    const planResult = await createDutyPlan({
      organizationId: organization.id,
      regionId: region.id,
      name: `Pelitli Planı ${testRunId()}`,
      userId: user.id,
      validFrom: "2026-08-01",
    });
    expect(planResult.ok).toBe(true);
    if (!planResult.ok) return;
    cleanupIds.planIds.push(planResult.planId);
    const versionId = planResult.versionId;

    const dayTypeResult = await setDayTypeRules({
      organizationId: organization.id,
      versionId,
      rules: ALL_DAY_TYPES.map((dayType) => ({
        dayType,
        isServed: dayType === "SATURDAY" || dayType === "OFFICIAL_HOLIDAY" || dayType === "RELIGIOUS_HOLIDAY",
      })),
      userId: user.id,
    });
    expect(dayTypeResult.ok).toBe(true);

    const shiftResult = await setShiftDefinitions({
      organizationId: organization.id,
      versionId,
      shifts: [
        { name: "Günlük Nöbet", startMinute: 0, endMinute: 1439, spansMidnight: false, defaultWeight: 1, sortOrder: 0 },
      ],
      userId: user.id,
    });
    expect(shiftResult.ok).toBe(true);

    const saturdayPoolId = await createPoolWithMembers(
      organization.id,
      region.id,
      user.id,
      pharmacies.slice(0, 4).map((p) => p.id),
      `Cumartesi Havuzu ${testRunId()}`
    );
    const holidayPoolId = await createPoolWithMembers(
      organization.id,
      region.id,
      user.id,
      pharmacies.slice(4, 6).map((p) => p.id),
      `Bayram Havuzu ${testRunId()}`
    );

    const version = await prisma.dutyPlanVersion.findUniqueOrThrow({
      where: { id: versionId },
      include: { dayTypeRules: true },
    });
    const ruleByDayType = new Map(version.dayTypeRules.map((r) => [r.dayType, r.id]));

    const shifts = await prisma.shiftDefinition.findMany({ where: { planVersionId: versionId } });
    const shiftId = shifts[0].id;

    const finalSlotResult = await setSlotRequirements({
      organizationId: organization.id,
      versionId,
      slots: [
        {
          dayTypeRuleId: ruleByDayType.get("SATURDAY")!,
          shiftDefinitionId: shiftId,
          rotationPoolId: saturdayPoolId,
          requiredCount: 1,
          sortOrder: 0,
        },
        {
          dayTypeRuleId: ruleByDayType.get("OFFICIAL_HOLIDAY")!,
          shiftDefinitionId: shiftId,
          rotationPoolId: holidayPoolId,
          requiredCount: 1,
          sortOrder: 0,
        },
        {
          dayTypeRuleId: ruleByDayType.get("RELIGIOUS_HOLIDAY")!,
          shiftDefinitionId: shiftId,
          rotationPoolId: holidayPoolId,
          requiredCount: 1,
          sortOrder: 0,
        },
      ],
      userId: user.id,
    });
    expect(finalSlotResult).toEqual({ ok: true, count: 3 });

    const readiness = await checkPlanVersionActivationReadiness({
      organizationId: organization.id,
      regionId: region.id,
      versionId,
    });
    expect(readiness.ok).toBe(true);

    const activation = await activatePlanVersion({
      organizationId: organization.id,
      regionId: region.id,
      planVersionId: versionId,
      userId: user.id,
    });
    expect(activation).toMatchObject({ ok: true, outcome: "ACTIVATED" });

    const loaded = await loadDutyPlanVersion({
      organizationId: organization.id,
      regionId: region.id,
      planVersionId: versionId,
    });
    expect(loaded.status).toBe("ACTIVE");
    const servedWithSlots = loaded.dayTypeRules.filter(
      (r) => r.isServed && loaded.slotRequirements.some((s) => s.dayTypeRuleId === r.id)
    );
    const unserved = loaded.dayTypeRules.filter((r) => !r.isServed);
    expect(servedWithSlots.map((r) => r.dayType).sort()).toEqual(
      ["OFFICIAL_HOLIDAY", "RELIGIOUS_HOLIDAY", "SATURDAY"].sort()
    );
    expect(unserved.map((r) => r.dayType).sort()).toEqual(["HOLIDAY_EVE", "SUNDAY", "WEEKDAY"].sort());
    const distinctPoolIds = new Set(loaded.slotRequirements.map((s) => s.rotationPoolId));
    expect(distinctPoolIds.size).toBe(2);
    expect(distinctPoolIds).toEqual(new Set([saturdayPoolId, holidayPoolId]));
  });

  // -------------------------------------------------------------------
  // Vakfıkebir modeli
  // -------------------------------------------------------------------
  it("Vakfıkebir modeli: her gün 1 eczane", async () => {
    const { organization, region, user, pharmacies } = await setupOrgRegion(5);
    await createTestDutyRule(region.id);

    const planResult = await createDutyPlan({
      organizationId: organization.id,
      regionId: region.id,
      name: `Vakfıkebir Planı ${testRunId()}`,
      userId: user.id,
      validFrom: "2026-08-01",
    });
    expect(planResult.ok).toBe(true);
    if (!planResult.ok) return;
    cleanupIds.planIds.push(planResult.planId);
    const versionId = planResult.versionId;

    await setDayTypeRules({
      organizationId: organization.id,
      versionId,
      rules: ALL_DAY_TYPES.map((dayType) => ({ dayType, isServed: true })),
      userId: user.id,
    });
    await setShiftDefinitions({
      organizationId: organization.id,
      versionId,
      shifts: [
        { name: "Günlük Nöbet", startMinute: 0, endMinute: 1439, spansMidnight: false, defaultWeight: 1, sortOrder: 0 },
      ],
      userId: user.id,
    });

    const poolId = await createPoolWithMembers(
      organization.id,
      region.id,
      user.id,
      pharmacies.map((p) => p.id),
      `Vakfıkebir Havuzu ${testRunId()}`
    );
    // The engine reads persisted RotationState — created directly (no
    // Phase 11 service exists for it, since Phase 9's publish is the only
    // documented writer of currentRound/lockVersion progression; a fresh
    // pool simply starts at round 0).
    await prisma.rotationState.create({
      data: { poolId, dayTypeScope: "ALL", currentRound: 0, lockVersion: 0 },
    });

    const version = await prisma.dutyPlanVersion.findUniqueOrThrow({
      where: { id: versionId },
      include: { dayTypeRules: true },
    });
    const shift = await prisma.shiftDefinition.findFirstOrThrow({ where: { planVersionId: versionId } });

    const slotResult = await setSlotRequirements({
      organizationId: organization.id,
      versionId,
      slots: version.dayTypeRules.map((rule, i) => ({
        dayTypeRuleId: rule.id,
        shiftDefinitionId: shift.id,
        rotationPoolId: poolId,
        requiredCount: 1,
        sortOrder: i,
      })),
      userId: user.id,
    });
    expect(slotResult.ok).toBe(true);

    const readiness = await checkPlanVersionActivationReadiness({
      organizationId: organization.id,
      regionId: region.id,
      versionId,
    });
    expect(readiness.ok).toBe(true);

    const activation = await activatePlanVersion({
      organizationId: organization.id,
      regionId: region.id,
      planVersionId: versionId,
      userId: user.id,
    });
    expect(activation).toMatchObject({ ok: true, outcome: "ACTIVATED" });

    const assembled = await assembleV1CompatibilityEngineInput({
      organizationId: organization.id,
      regionId: region.id,
      periodStart: "2026-08-03",
      periodEnd: "2026-08-16",
    });
    expect(assembled.ok).toBe(true);
    if (!assembled.ok) return;

    const result = buildDutyEngineContext(assembled.input);
    expect(result.completeDraftSchedule.status).toBe("COMPLETE");
    const byDate = new Map<string, number>();
    for (const a of result.completeDraftSchedule.assignments) {
      byDate.set(a.date, (byDate.get(a.date) ?? 0) + 1);
    }
    for (const count of byDate.values()) {
      expect(count).toBe(1);
    }
    expect(byDate.size).toBe(14);
  });

  // -------------------------------------------------------------------
  // Akçaabat modeli
  // -------------------------------------------------------------------
  it("Akçaabat modeli: her gün 2 eczane", async () => {
    const { organization, region, user, pharmacies } = await setupOrgRegion(12);
    await createTestDutyRule(region.id);

    const planResult = await createDutyPlan({
      organizationId: organization.id,
      regionId: region.id,
      name: `Akçaabat Planı ${testRunId()}`,
      userId: user.id,
      validFrom: "2026-08-01",
    });
    expect(planResult.ok).toBe(true);
    if (!planResult.ok) return;
    cleanupIds.planIds.push(planResult.planId);
    const versionId = planResult.versionId;

    await setDayTypeRules({
      organizationId: organization.id,
      versionId,
      rules: ALL_DAY_TYPES.map((dayType) => ({ dayType, isServed: true })),
      userId: user.id,
    });
    await setShiftDefinitions({
      organizationId: organization.id,
      versionId,
      shifts: [
        { name: "Günlük Nöbet", startMinute: 0, endMinute: 1439, spansMidnight: false, defaultWeight: 1, sortOrder: 0 },
      ],
      userId: user.id,
    });

    const poolId = await createPoolWithMembers(
      organization.id,
      region.id,
      user.id,
      pharmacies.map((p) => p.id),
      `Akçaabat Havuzu ${testRunId()}`
    );
    await prisma.rotationState.create({
      data: { poolId, dayTypeScope: "ALL", currentRound: 0, lockVersion: 0 },
    });

    const version = await prisma.dutyPlanVersion.findUniqueOrThrow({
      where: { id: versionId },
      include: { dayTypeRules: true },
    });
    const shift = await prisma.shiftDefinition.findFirstOrThrow({ where: { planVersionId: versionId } });

    const slotResult = await setSlotRequirements({
      organizationId: organization.id,
      versionId,
      slots: version.dayTypeRules.map((rule, i) => ({
        dayTypeRuleId: rule.id,
        shiftDefinitionId: shift.id,
        rotationPoolId: poolId,
        requiredCount: 2,
        sortOrder: i,
      })),
      userId: user.id,
    });
    expect(slotResult.ok).toBe(true);

    const activation = await activatePlanVersion({
      organizationId: organization.id,
      regionId: region.id,
      planVersionId: versionId,
      userId: user.id,
    });
    expect(activation).toMatchObject({ ok: true, outcome: "ACTIVATED" });

    const assembled = await assembleV1CompatibilityEngineInput({
      organizationId: organization.id,
      regionId: region.id,
      periodStart: "2026-08-03",
      periodEnd: "2026-08-16",
    });
    expect(assembled.ok).toBe(true);
    if (!assembled.ok) return;

    const result = buildDutyEngineContext(assembled.input);
    expect(result.completeDraftSchedule.status).toBe("COMPLETE");
    const byDate = new Map<string, number>();
    for (const a of result.completeDraftSchedule.assignments) {
      byDate.set(a.date, (byDate.get(a.date) ?? 0) + 1);
    }
    for (const count of byDate.values()) {
      expect(count).toBe(2);
    }
    expect(byDate.size).toBe(14);
  });

  // -------------------------------------------------------------------
  // Activation concurrency
  // -------------------------------------------------------------------
  it("activation concurrency: two DRAFT versions of the same region racing to activate leaves exactly one ACTIVE", async () => {
    const { organization, region, user } = await setupOrgRegion(1);

    const planA = await createDutyPlan({
      organizationId: organization.id,
      regionId: region.id,
      name: `Plan A ${testRunId()}`,
      userId: user.id,
      validFrom: "2026-08-01",
    });
    expect(planA.ok).toBe(true);
    if (!planA.ok) return;
    cleanupIds.planIds.push(planA.planId);

    const planB = await createDutyPlan({
      organizationId: organization.id,
      regionId: region.id,
      name: `Plan B ${testRunId()}`,
      userId: user.id,
      validFrom: "2026-09-01",
    });
    expect(planB.ok).toBe(true);
    if (!planB.ok) return;
    cleanupIds.planIds.push(planB.planId);

    // Give both a minimal but activation-ready configuration (served
    // Saturday + a slot + a non-empty pool), independently.
    async function makeReady(versionId: string, validFromIso: string) {
      await setDayTypeRules({
        organizationId: organization.id,
        versionId,
        rules: ALL_DAY_TYPES.map((dayType) => ({ dayType, isServed: dayType === "SATURDAY" })),
        userId: user.id,
      });
      await setShiftDefinitions({
        organizationId: organization.id,
        versionId,
        shifts: [{ name: "Nöbet", startMinute: 0, endMinute: 1439, spansMidnight: false, defaultWeight: 1, sortOrder: 0 }],
        userId: user.id,
      });
      const pool = await createRotationPool({
        organizationId: organization.id,
        regionId: region.id,
        name: `Havuz ${testRunId()}`,
        strategy: "SEQUENTIAL",
        userId: user.id,
      });
      expect(pool.ok).toBe(true);
      if (!pool.ok) return;
      cleanupIds.poolIds.push(pool.poolId);
      const pharmacy = await createTestPharmacy(tracked, region.id);
      await addPoolMembership({
        organizationId: organization.id,
        poolId: pool.poolId,
        pharmacyId: pharmacy.id,
        joinedAt: validFromIso,
        userId: user.id,
      });
      const v = await prisma.dutyPlanVersion.findUniqueOrThrow({
        where: { id: versionId },
        include: { dayTypeRules: true, shiftDefinitions: true },
      });
      const rule = v.dayTypeRules.find((r) => r.dayType === "SATURDAY")!;
      await setSlotRequirements({
        organizationId: organization.id,
        versionId,
        slots: [
          {
            dayTypeRuleId: rule.id,
            shiftDefinitionId: v.shiftDefinitions[0].id,
            rotationPoolId: pool.poolId,
            requiredCount: 1,
            sortOrder: 0,
          },
        ],
        userId: user.id,
      });
    }

    await makeReady(planA.versionId, "2026-08-01");
    await makeReady(planB.versionId, "2026-09-01");

    const [resultA, resultB] = await Promise.all([
      activatePlanVersion({
        organizationId: organization.id,
        regionId: region.id,
        planVersionId: planA.versionId,
        userId: user.id,
      }),
      activatePlanVersion({
        organizationId: organization.id,
        regionId: region.id,
        planVersionId: planB.versionId,
        userId: user.id,
      }),
    ]);

    expect(resultA.ok).toBe(true);
    expect(resultB.ok).toBe(true);

    const activeVersions = await prisma.dutyPlanVersion.findMany({
      where: { plan: { regionId: region.id }, status: "ACTIVE" },
    });
    expect(activeVersions).toHaveLength(1);

    const retiredVersions = await prisma.dutyPlanVersion.findMany({
      where: { plan: { regionId: region.id }, status: "RETIRED" },
    });
    for (const retired of retiredVersions) {
      expect(retired.validTo).not.toBeNull();
    }
  });

  // -------------------------------------------------------------------
  // Cross-tenant rejection
  // -------------------------------------------------------------------
  it("cross-tenant rejection: every mutation service rejects a plan/version/pool belonging to another organization", async () => {
    const { organization, region, user } = await setupOrgRegion(2);
    const otherOrg = await createTestOrganization(tracked);

    const planResult = await createDutyPlan({
      organizationId: organization.id,
      regionId: region.id,
      name: `Cross-Tenant Plan ${testRunId()}`,
      userId: user.id,
      validFrom: "2026-08-01",
    });
    expect(planResult.ok).toBe(true);
    if (!planResult.ok) return;
    cleanupIds.planIds.push(planResult.planId);
    const versionId = planResult.versionId;

    const pool = await createRotationPool({
      organizationId: organization.id,
      regionId: region.id,
      name: `Cross-Tenant Havuz ${testRunId()}`,
      strategy: "SEQUENTIAL",
      userId: user.id,
    });
    expect(pool.ok).toBe(true);
    if (!pool.ok) return;
    cleanupIds.poolIds.push(pool.poolId);

    // Region belongs to a different organization than otherOrg.
    const foreignPlan = await createDutyPlan({
      organizationId: otherOrg.id,
      regionId: region.id,
      name: "Should Fail",
      userId: user.id,
    });
    expect(foreignPlan).toEqual({ ok: false, code: "REGION_NOT_FOUND", message: expect.any(String) });

    const foreignVersion = await createPlanVersion({
      organizationId: otherOrg.id,
      planId: planResult.planId,
      userId: user.id,
    });
    expect(foreignVersion).toEqual({ ok: false, code: "PLAN_NOT_FOUND", message: expect.any(String) });

    const foreignDayTypes = await setDayTypeRules({
      organizationId: otherOrg.id,
      versionId,
      rules: ALL_DAY_TYPES.map((dayType) => ({ dayType, isServed: dayType === "SATURDAY" })),
      userId: user.id,
    });
    expect(foreignDayTypes).toEqual({ ok: false, code: "VERSION_NOT_FOUND", message: expect.any(String) });

    const foreignShifts = await setShiftDefinitions({
      organizationId: otherOrg.id,
      versionId,
      shifts: [{ name: "X", startMinute: 0, endMinute: 100, spansMidnight: false, defaultWeight: 1, sortOrder: 0 }],
      userId: user.id,
    });
    expect(foreignShifts).toEqual({ ok: false, code: "VERSION_NOT_FOUND", message: expect.any(String) });

    const foreignSlots = await setSlotRequirements({
      organizationId: otherOrg.id,
      versionId,
      slots: [],
      userId: user.id,
    });
    expect(foreignSlots).toEqual({ ok: false, code: "VERSION_NOT_FOUND", message: expect.any(String) });

    const foreignPool = await createRotationPool({
      organizationId: otherOrg.id,
      regionId: region.id,
      name: "Should Fail",
      strategy: "SEQUENTIAL",
      userId: user.id,
    });
    expect(foreignPool).toEqual({ ok: false, code: "REGION_NOT_FOUND", message: expect.any(String) });

    const otherOrgPharmacyRegion = await createTestRegion(tracked, { organizationId: otherOrg.id });
    const foreignPharmacy = await createTestPharmacy(tracked, otherOrgPharmacyRegion.id);
    const foreignMembership = await addPoolMembership({
      organizationId: otherOrg.id,
      poolId: pool.poolId,
      pharmacyId: foreignPharmacy.id,
      joinedAt: "2026-01-01",
      userId: user.id,
    });
    expect(foreignMembership).toEqual({ ok: false, code: "POOL_NOT_FOUND", message: expect.any(String) });

    const foreignActivation = await activatePlanVersion({
      organizationId: otherOrg.id,
      regionId: region.id,
      planVersionId: versionId,
      userId: user.id,
    });
    expect(foreignActivation).toEqual({ ok: false, code: "VERSION_NOT_FOUND", message: expect.any(String) });

    // Confirm nothing was actually written under the foreign organization.
    const plans = await prisma.dutyPlan.findMany({ where: { organizationId: otherOrg.id } });
    expect(plans).toHaveLength(0);
  });

  // -------------------------------------------------------------------
  // Edit-frozen enforcement
  // -------------------------------------------------------------------
  it("edit-frozen enforcement: mutating an ACTIVE (non-DRAFT) version's day types/shifts/slots is rejected, DB state unchanged", async () => {
    const { organization, region, user, pharmacies } = await setupOrgRegion(2);

    const planResult = await createDutyPlan({
      organizationId: organization.id,
      regionId: region.id,
      name: `Frozen Plan ${testRunId()}`,
      userId: user.id,
      validFrom: "2026-08-01",
    });
    expect(planResult.ok).toBe(true);
    if (!planResult.ok) return;
    cleanupIds.planIds.push(planResult.planId);
    const versionId = planResult.versionId;

    await setDayTypeRules({
      organizationId: organization.id,
      versionId,
      rules: ALL_DAY_TYPES.map((dayType) => ({ dayType, isServed: dayType === "SATURDAY" })),
      userId: user.id,
    });
    await setShiftDefinitions({
      organizationId: organization.id,
      versionId,
      shifts: [{ name: "Nöbet", startMinute: 0, endMinute: 1439, spansMidnight: false, defaultWeight: 1, sortOrder: 0 }],
      userId: user.id,
    });
    const poolId = await createPoolWithMembers(
      organization.id,
      region.id,
      user.id,
      pharmacies.map((p) => p.id),
      `Frozen Havuzu ${testRunId()}`
    );
    const version = await prisma.dutyPlanVersion.findUniqueOrThrow({
      where: { id: versionId },
      include: { dayTypeRules: true, shiftDefinitions: true },
    });
    const saturdayRule = version.dayTypeRules.find((r) => r.dayType === "SATURDAY")!;
    await setSlotRequirements({
      organizationId: organization.id,
      versionId,
      slots: [
        {
          dayTypeRuleId: saturdayRule.id,
          shiftDefinitionId: version.shiftDefinitions[0].id,
          rotationPoolId: poolId,
          requiredCount: 1,
          sortOrder: 0,
        },
      ],
      userId: user.id,
    });

    const activation = await activatePlanVersion({
      organizationId: organization.id,
      regionId: region.id,
      planVersionId: versionId,
      userId: user.id,
    });
    expect(activation).toMatchObject({ ok: true, outcome: "ACTIVATED" });

    const beforeDayTypeCount = await prisma.dayTypeRule.count({ where: { planVersionId: versionId } });
    const beforeShiftCount = await prisma.shiftDefinition.count({ where: { planVersionId: versionId } });
    const beforeSlotCount = await prisma.slotRequirement.count({ where: { dayTypeRule: { planVersionId: versionId } } });

    const dayTypeAttempt = await setDayTypeRules({
      organizationId: organization.id,
      versionId,
      rules: [{ dayType: "SUNDAY", isServed: true }],
      userId: user.id,
    });
    expect(dayTypeAttempt).toEqual({ ok: false, code: "VERSION_NOT_DRAFT", message: expect.any(String) });

    const shiftAttempt = await setShiftDefinitions({
      organizationId: organization.id,
      versionId,
      shifts: [{ name: "Yeni Vardiya", startMinute: 0, endMinute: 100, spansMidnight: false, defaultWeight: 1, sortOrder: 0 }],
      userId: user.id,
    });
    expect(shiftAttempt).toEqual({ ok: false, code: "VERSION_NOT_DRAFT", message: expect.any(String) });

    const slotAttempt = await setSlotRequirements({
      organizationId: organization.id,
      versionId,
      slots: [],
      userId: user.id,
    });
    expect(slotAttempt).toEqual({ ok: false, code: "VERSION_NOT_DRAFT", message: expect.any(String) });

    const afterDayTypeCount = await prisma.dayTypeRule.count({ where: { planVersionId: versionId } });
    const afterShiftCount = await prisma.shiftDefinition.count({ where: { planVersionId: versionId } });
    const afterSlotCount = await prisma.slotRequirement.count({ where: { dayTypeRule: { planVersionId: versionId } } });
    expect(afterDayTypeCount).toBe(beforeDayTypeCount);
    expect(afterShiftCount).toBe(beforeShiftCount);
    expect(afterSlotCount).toBe(beforeSlotCount);

    // Pool membership is deliberately NOT version-scoped (RotationPool is
    // owned by the organization/region, not by a plan version — a pool
    // can be shared across versions and across time), so there is no
    // DRAFT-status gate to enforce here; this is a documented deviation
    // from a literal per-version freeze for this one row type.
    const newPharmacy = await createTestPharmacy(tracked, region.id);
    const membershipAfterActivation = await addPoolMembership({
      organizationId: organization.id,
      poolId,
      pharmacyId: newPharmacy.id,
      joinedAt: "2026-08-10",
      userId: user.id,
    });
    expect(membershipAfterActivation.ok).toBe(true);
  });
});
