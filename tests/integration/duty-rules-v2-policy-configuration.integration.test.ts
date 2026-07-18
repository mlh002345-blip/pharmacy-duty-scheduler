// Duty Rules V2 — Phase 12: policy configuration services, against a real
// Postgres database. Mirrors
// duty-rules-v2-plan-configuration.integration.test.ts's fixture/cleanup
// style. The core acceptance proof: a brand-new region with ZERO
// DutyRule history can be fully configured (day types + weights + policy
// + shifts + slots + pool + memberships) purely through Phase 11 + Phase
// 12 services and generate a complete draft — with no V1 fallback
// available at all.

import { afterEach, describe, expect, it } from "vitest";

import { prisma } from "@/lib/prisma";
import { buildDutyEngineContext } from "@/lib/duty-rules-v2/engine/build-engine-context";
import { assembleV1CompatibilityEngineInput } from "@/lib/duty-rules-v2/ui/assemble-v1-compatibility-engine-input";
import { assembleV2NativeEngineInput } from "@/lib/duty-rules-v2/ui/assemble-v2-native-engine-input";
import type { BuiltinDayType } from "@/lib/duty-rules-v2/domain/loaded-plan";

import { createDutyPlan } from "@/lib/duty-rules-v2/configuration/create-duty-plan";
import { setDayTypeRules } from "@/lib/duty-rules-v2/configuration/update-day-type-rules";
import { setShiftDefinitions } from "@/lib/duty-rules-v2/configuration/update-shift-definitions";
import { setSlotRequirements } from "@/lib/duty-rules-v2/configuration/update-slot-requirements";
import { createRotationPool } from "@/lib/duty-rules-v2/configuration/create-rotation-pool";
import { addPoolMembership } from "@/lib/duty-rules-v2/configuration/update-pool-membership";
import { checkPlanVersionActivationReadiness } from "@/lib/duty-rules-v2/configuration/validate-plan-version-completeness";
import { activatePlanVersion } from "@/lib/duty-rules-v2/configuration/activate-plan-version";
import { setPlanVersionPolicy } from "@/lib/duty-rules-v2/configuration/update-plan-version-policy";

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

const DAY_TYPE_WEIGHTS: Record<BuiltinDayType, number> = {
  WEEKDAY: 1,
  SATURDAY: 1.25,
  SUNDAY: 1.5,
  OFFICIAL_HOLIDAY: 2,
  RELIGIOUS_HOLIDAY: 2,
  HOLIDAY_EVE: 1,
};

describe("Duty Rules V2 Phase 12 — policy configuration services (real Postgres)", () => {
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

  async function setupOrgRegion(pharmacyCount = 5) {
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

  /** Configures a fully-native (no DutyRule dependency) plan version:
   *  every day type served, weighted, one shift, one pool with all
   *  pharmacies, one slot per day type, full native policy. Returns the
   *  versionId, ready to activate. */
  async function configureNativeVersion(
    organizationId: string,
    regionId: string,
    userId: string,
    pharmacyIds: string[],
    validFrom: string
  ) {
    const planResult = await createDutyPlan({
      organizationId,
      regionId,
      name: `Native Plan ${testRunId()}`,
      userId,
      validFrom,
    });
    expect(planResult.ok).toBe(true);
    if (!planResult.ok) throw new Error("plan creation failed");
    cleanupIds.planIds.push(planResult.planId);
    const versionId = planResult.versionId;

    const dayTypeResult = await setDayTypeRules({
      organizationId,
      versionId,
      rules: ALL_DAY_TYPES.map((dayType) => ({
        dayType,
        isServed: true,
        weight: DAY_TYPE_WEIGHTS[dayType],
      })),
      userId,
    });
    expect(dayTypeResult.ok).toBe(true);

    const policyResult = await setPlanVersionPolicy({
      organizationId,
      versionId,
      minDaysBetweenDuties: 0,
      relaxMinIntervalWhenInsufficient: true,
      sameDaySecondAssignmentAllowed: false,
      holidayEveWeightSource: "UNDERLYING_WEEKDAY",
      holidayOverlapResolutionMode: "NATIVE_PRECEDENCE",
      userId,
    });
    expect(policyResult.ok).toBe(true);

    const shiftResult = await setShiftDefinitions({
      organizationId,
      versionId,
      shifts: [
        { name: "Günlük Nöbet", startMinute: 0, endMinute: 1439, spansMidnight: false, defaultWeight: 1, sortOrder: 0 },
      ],
      userId,
    });
    expect(shiftResult.ok).toBe(true);

    const poolId = await createPoolWithMembers(
      organizationId,
      regionId,
      userId,
      pharmacyIds,
      `Native Havuz ${testRunId()}`
    );
    await prisma.rotationState.create({
      data: { poolId, dayTypeScope: "ALL", currentRound: 0, lockVersion: 0 },
    });

    const version = await prisma.dutyPlanVersion.findUniqueOrThrow({
      where: { id: versionId },
      include: { dayTypeRules: true, shiftDefinitions: true },
    });

    const slotResult = await setSlotRequirements({
      organizationId,
      versionId,
      slots: version.dayTypeRules.map((rule, i) => ({
        dayTypeRuleId: rule.id,
        shiftDefinitionId: version.shiftDefinitions[0].id,
        rotationPoolId: poolId,
        requiredCount: 1,
        sortOrder: i,
      })),
      userId,
    });
    expect(slotResult.ok).toBe(true);

    return versionId;
  }

  // -------------------------------------------------------------------
  // Core acceptance: brand-new region, zero DutyRule history
  // -------------------------------------------------------------------
  it("V1 geçmişi olmayan yepyeni bir oda: DutyRule olmadan tam bir V2 taslağı üretilebilir", async () => {
    const { organization, region, user, pharmacies } = await setupOrgRegion(5);

    const dutyRuleCount = await prisma.dutyRule.count({ where: { regionId: region.id } });
    expect(dutyRuleCount).toBe(0);

    const versionId = await configureNativeVersion(
      organization.id,
      region.id,
      user.id,
      pharmacies.map((p) => p.id),
      "2026-08-01"
    );

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

    // Still no DutyRule anywhere for this region — proves generation
    // below cannot possibly be falling back to V1 compatibility mode.
    const dutyRuleCountAfter = await prisma.dutyRule.count({ where: { regionId: region.id } });
    expect(dutyRuleCountAfter).toBe(0);

    const assembled = await assembleV2NativeEngineInput({
      organizationId: organization.id,
      regionId: region.id,
      periodStart: "2026-08-03",
      periodEnd: "2026-08-16",
    });
    expect(assembled.ok).toBe(true);
    if (!assembled.ok) return;

    const result = buildDutyEngineContext(assembled.input);
    expect(result.completeDraftSchedule.status).toBe("COMPLETE");
    expect(result.completeDraftSchedule.assignments.length).toBeGreaterThan(0);
  });

  // -------------------------------------------------------------------
  // Backward compatibility regression
  // -------------------------------------------------------------------
  it("geriye dönük uyumluluk: mevcut tarz (DutyRule'lu, politikası yapılandırılmamış) bölge V1 uyumluluk modunda değişmeden çalışır", async () => {
    const { organization, region, user, pharmacies } = await setupOrgRegion(5);
    await createTestDutyRule(region.id);

    const planResult = await createDutyPlan({
      organizationId: organization.id,
      regionId: region.id,
      name: `V1 Compat Plan ${testRunId()}`,
      userId: user.id,
      validFrom: "2026-08-01",
    });
    expect(planResult.ok).toBe(true);
    if (!planResult.ok) return;
    cleanupIds.planIds.push(planResult.planId);
    const versionId = planResult.versionId;

    // Configured purely through Phase 11 services, deliberately NEVER
    // calling setPlanVersionPolicy — minDaysBetweenDuties stays null,
    // exactly the pre-Phase-12 shape.
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
      `V1 Compat Havuz ${testRunId()}`
    );
    await prisma.rotationState.create({
      data: { poolId, dayTypeScope: "ALL", currentRound: 0, lockVersion: 0 },
    });
    const version = await prisma.dutyPlanVersion.findUniqueOrThrow({
      where: { id: versionId },
      include: { dayTypeRules: true, shiftDefinitions: true },
    });
    await setSlotRequirements({
      organizationId: organization.id,
      versionId,
      slots: version.dayTypeRules.map((rule, i) => ({
        dayTypeRuleId: rule.id,
        shiftDefinitionId: version.shiftDefinitions[0].id,
        rotationPoolId: poolId,
        requiredCount: 1,
        sortOrder: i,
      })),
      userId: user.id,
    });

    const activation = await activatePlanVersion({
      organizationId: organization.id,
      regionId: region.id,
      planVersionId: versionId,
      userId: user.id,
    });
    expect(activation).toMatchObject({ ok: true, outcome: "ACTIVATED" });

    // Confirm the version's own Phase 12 column is genuinely untouched.
    const reloaded = await prisma.dutyPlanVersion.findUniqueOrThrow({ where: { id: versionId } });
    expect(reloaded.minDaysBetweenDuties).toBeNull();

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
  // Mode-selection correctness
  // -------------------------------------------------------------------
  it("mode seçimi: minDaysBetweenDuties dolu bir sürüm için native motor DutyRule olmadan başarılı olur, boş bir sürüm için POLICY_NOT_CONFIGURED döner", async () => {
    const { organization, region, user, pharmacies } = await setupOrgRegion(3);

    const versionId = await configureNativeVersion(
      organization.id,
      region.id,
      user.id,
      pharmacies.map((p) => p.id),
      "2026-08-01"
    );
    await activatePlanVersion({
      organizationId: organization.id,
      regionId: region.id,
      planVersionId: versionId,
      userId: user.id,
    });

    // Native assembler succeeds without any DutyRule.
    const nativeResult = await assembleV2NativeEngineInput({
      organizationId: organization.id,
      regionId: region.id,
      periodStart: "2026-08-03",
      periodEnd: "2026-08-16",
    });
    expect(nativeResult.ok).toBe(true);

    // V1-compatibility assembler still requires a DutyRule — unrelated to
    // this phase, still true.
    const v1Result = await assembleV1CompatibilityEngineInput({
      organizationId: organization.id,
      regionId: region.id,
      periodStart: "2026-08-03",
      periodEnd: "2026-08-16",
    });
    expect(v1Result).toEqual({ ok: false, code: "NO_DUTY_RULE", message: expect.any(String) });

    // A second region/plan whose version has minDaysBetweenDuties left
    // null yields POLICY_NOT_CONFIGURED from the native assembler.
    const region2 = await createTestRegion(tracked, { organizationId: organization.id });
    const pharmacy2 = await createTestPharmacy(tracked, region2.id);
    const plan2 = await createDutyPlan({
      organizationId: organization.id,
      regionId: region2.id,
      name: `Unconfigured Plan ${testRunId()}`,
      userId: user.id,
      validFrom: "2026-08-01",
    });
    expect(plan2.ok).toBe(true);
    if (!plan2.ok) return;
    cleanupIds.planIds.push(plan2.planId);
    await setDayTypeRules({
      organizationId: organization.id,
      versionId: plan2.versionId,
      rules: ALL_DAY_TYPES.map((dayType) => ({ dayType, isServed: dayType === "SATURDAY" })),
      userId: user.id,
    });
    await setShiftDefinitions({
      organizationId: organization.id,
      versionId: plan2.versionId,
      shifts: [{ name: "Nöbet", startMinute: 0, endMinute: 1439, spansMidnight: false, defaultWeight: 1, sortOrder: 0 }],
      userId: user.id,
    });
    const pool2 = await createPoolWithMembers(
      organization.id,
      region2.id,
      user.id,
      [pharmacy2.id],
      `Unconfigured Havuz ${testRunId()}`
    );
    const v2 = await prisma.dutyPlanVersion.findUniqueOrThrow({
      where: { id: plan2.versionId },
      include: { dayTypeRules: true, shiftDefinitions: true },
    });
    const saturdayRule = v2.dayTypeRules.find((r) => r.dayType === "SATURDAY")!;
    await setSlotRequirements({
      organizationId: organization.id,
      versionId: plan2.versionId,
      slots: [
        {
          dayTypeRuleId: saturdayRule.id,
          shiftDefinitionId: v2.shiftDefinitions[0].id,
          rotationPoolId: pool2,
          requiredCount: 1,
          sortOrder: 0,
        },
      ],
      userId: user.id,
    });
    await activatePlanVersion({
      organizationId: organization.id,
      regionId: region2.id,
      planVersionId: plan2.versionId,
      userId: user.id,
    });

    const unconfiguredResult = await assembleV2NativeEngineInput({
      organizationId: organization.id,
      regionId: region2.id,
      periodStart: "2026-08-03",
      periodEnd: "2026-08-16",
    });
    expect(unconfiguredResult).toEqual({
      ok: false,
      code: "POLICY_NOT_CONFIGURED",
      message: expect.any(String),
    });
  });

  // -------------------------------------------------------------------
  // MISSING_DAY_TYPE_WEIGHT
  // -------------------------------------------------------------------
  it("MISSING_DAY_TYPE_WEIGHT: ağırlığı olmayan nöbet tutan bir gün tipi reddedilir, DB durumu değişmez, kısmi üretim olmaz", async () => {
    const { organization, region, user, pharmacies } = await setupOrgRegion(3);

    const planResult = await createDutyPlan({
      organizationId: organization.id,
      regionId: region.id,
      name: `Missing Weight Plan ${testRunId()}`,
      userId: user.id,
      validFrom: "2026-08-01",
    });
    expect(planResult.ok).toBe(true);
    if (!planResult.ok) return;
    cleanupIds.planIds.push(planResult.planId);
    const versionId = planResult.versionId;

    // WEEKDAY served with no weight, SATURDAY served with a weight.
    await setDayTypeRules({
      organizationId: organization.id,
      versionId,
      rules: [
        { dayType: "WEEKDAY", isServed: true, weight: null },
        { dayType: "SATURDAY", isServed: true, weight: 1.25 },
        { dayType: "SUNDAY", isServed: false, weight: null },
        { dayType: "OFFICIAL_HOLIDAY", isServed: false, weight: null },
        { dayType: "RELIGIOUS_HOLIDAY", isServed: false, weight: null },
        { dayType: "HOLIDAY_EVE", isServed: false, weight: null },
      ],
      userId: user.id,
    });
    await setPlanVersionPolicy({
      organizationId: organization.id,
      versionId,
      minDaysBetweenDuties: 0,
      relaxMinIntervalWhenInsufficient: true,
      sameDaySecondAssignmentAllowed: false,
      holidayEveWeightSource: "CONFIGURED",
      holidayOverlapResolutionMode: "NATIVE_PRECEDENCE",
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
      `Missing Weight Havuz ${testRunId()}`
    );
    const version = await prisma.dutyPlanVersion.findUniqueOrThrow({
      where: { id: versionId },
      include: { dayTypeRules: true, shiftDefinitions: true },
    });
    const servedRules = version.dayTypeRules.filter((r) => r.isServed);
    await setSlotRequirements({
      organizationId: organization.id,
      versionId,
      slots: servedRules.map((rule, i) => ({
        dayTypeRuleId: rule.id,
        shiftDefinitionId: version.shiftDefinitions[0].id,
        rotationPoolId: poolId,
        requiredCount: 1,
        sortOrder: i,
      })),
      userId: user.id,
    });

    const activation = await activatePlanVersion({
      organizationId: organization.id,
      regionId: region.id,
      planVersionId: versionId,
      userId: user.id,
    });
    expect(activation).toMatchObject({ ok: true, outcome: "ACTIVATED" });

    const scheduleCountBefore = await prisma.dutySchedule.count({ where: { regionId: region.id } });

    const result = await assembleV2NativeEngineInput({
      organizationId: organization.id,
      regionId: region.id,
      periodStart: "2026-08-03",
      periodEnd: "2026-08-16",
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("MISSING_DAY_TYPE_WEIGHT");

    const scheduleCountAfter = await prisma.dutySchedule.count({ where: { regionId: region.id } });
    expect(scheduleCountAfter).toBe(scheduleCountBefore);
  });

  // -------------------------------------------------------------------
  // Cross-tenant rejection
  // -------------------------------------------------------------------
  it("cross-tenant rejection: setPlanVersionPolicy ve ağırlık taşıyan setDayTypeRules çağrıları başka bir organizasyona ait sürümü reddeder", async () => {
    const { organization, region, user } = await setupOrgRegion(1);
    const otherOrg = await createTestOrganization(tracked);

    const planResult = await createDutyPlan({
      organizationId: organization.id,
      regionId: region.id,
      name: `Cross-Tenant Policy Plan ${testRunId()}`,
      userId: user.id,
      validFrom: "2026-08-01",
    });
    expect(planResult.ok).toBe(true);
    if (!planResult.ok) return;
    cleanupIds.planIds.push(planResult.planId);
    const versionId = planResult.versionId;

    const foreignPolicy = await setPlanVersionPolicy({
      organizationId: otherOrg.id,
      versionId,
      minDaysBetweenDuties: 3,
      relaxMinIntervalWhenInsufficient: true,
      sameDaySecondAssignmentAllowed: false,
      holidayEveWeightSource: "CONFIGURED",
      holidayOverlapResolutionMode: "NATIVE_PRECEDENCE",
      userId: user.id,
    });
    expect(foreignPolicy).toEqual({ ok: false, code: "VERSION_NOT_FOUND", message: expect.any(String) });

    const foreignDayTypes = await setDayTypeRules({
      organizationId: otherOrg.id,
      versionId,
      rules: [{ dayType: "SATURDAY", isServed: true, weight: 1.25 }],
      userId: user.id,
    });
    expect(foreignDayTypes).toEqual({ ok: false, code: "VERSION_NOT_FOUND", message: expect.any(String) });

    const reloaded = await prisma.dutyPlanVersion.findUniqueOrThrow({ where: { id: versionId } });
    expect(reloaded.minDaysBetweenDuties).toBeNull();
    const dayTypeCount = await prisma.dayTypeRule.count({ where: { planVersionId: versionId } });
    expect(dayTypeCount).toBe(0);
  });

  // -------------------------------------------------------------------
  // Edit-frozen enforcement
  // -------------------------------------------------------------------
  it("edit-frozen enforcement: setPlanVersionPolicy ACTIVE bir sürüme karşı reddedilir", async () => {
    const { organization, region, user, pharmacies } = await setupOrgRegion(3);

    const versionId = await configureNativeVersion(
      organization.id,
      region.id,
      user.id,
      pharmacies.map((p) => p.id),
      "2026-08-01"
    );
    const activation = await activatePlanVersion({
      organizationId: organization.id,
      regionId: region.id,
      planVersionId: versionId,
      userId: user.id,
    });
    expect(activation).toMatchObject({ ok: true, outcome: "ACTIVATED" });

    const before = await prisma.dutyPlanVersion.findUniqueOrThrow({ where: { id: versionId } });

    const attempt = await setPlanVersionPolicy({
      organizationId: organization.id,
      versionId,
      minDaysBetweenDuties: 99,
      relaxMinIntervalWhenInsufficient: false,
      sameDaySecondAssignmentAllowed: true,
      holidayEveWeightSource: "UNDERLYING_WEEKDAY",
      holidayOverlapResolutionMode: "V1_LAST_INPUT_WINS",
      userId: user.id,
    });
    expect(attempt).toEqual({ ok: false, code: "VERSION_NOT_DRAFT", message: expect.any(String) });

    const after = await prisma.dutyPlanVersion.findUniqueOrThrow({ where: { id: versionId } });
    expect(after.minDaysBetweenDuties).toBe(before.minDaysBetweenDuties);
    expect(after.sameDaySecondAssignmentAllowed).toBe(before.sameDaySecondAssignmentAllowed);
  });
});
