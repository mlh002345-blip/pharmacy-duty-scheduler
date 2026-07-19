// Duty Rules V2 — Phase 15: V1 -> V2 migration assistant.
//
// A region running on V1 (a Region + its DutyRule) has no DutyPlan at
// all, so assemble-v1-compatibility-engine-input.ts's own documented
// limitation applies: "There is deliberately NO admin UI in this phase
// for creating/activating a plan version — every region without one
// simply returns NO_ACTIVE_PLAN_VERSION." Phase 11 later added that
// admin UI, but a chamber migrating from V1 would still have to
// hand-recreate, from scratch, a plan version that is BEHAVIORALLY
// IDENTICAL to their existing DutyRule before they can use any V2
// feature at all.
//
// This module is that one-click bridge. It orchestrates the existing
// Phase 11 configuration services (never raw Prisma writes for anything
// those services already own) to create an ACTIVE DutyPlanVersion whose
// day-type rules / shift / slot requirements / rotation pool are the
// direct persisted equivalent of the region's DutyRule — same mapping
// src/lib/duty-rules-v2/v1-adapter.ts already defines in-memory (V1_DAY_TYPES,
// "every day type served", "one whole-day shift", "one pool of all
// active pharmacies"). The created version's minDaysBetweenDuties is left
// null, so cizelgeler/v2/yeni's own mode-selection logic keeps deriving
// scheduling policy from the region's live DutyRule at generation time —
// the migrated version behaves exactly like V1 today, and stays in sync
// with any future V1 DutyRule edit, until an admin deliberately opts into
// native policy (Phase 12 UI) by giving the version its own
// minDaysBetweenDuties.
//
// NOT atomic across steps (mirrors how Phase 11's own configuration UI
// already works: a DRAFT plan is inert and harmless until activated).
// If this orchestration fails partway, the resulting partial DRAFT plan
// is not silently duplicated on retry — a region that already has ANY
// DutyPlan is refused outright — but it can always be finished by hand
// through the existing plan configuration UI at
// /cizelgeler/v2/planlar/[planId]/versions/[versionId].

import { prisma } from "@/lib/prisma";
import { createDutyPlan } from "../configuration/create-duty-plan";
import { setDayTypeRules } from "../configuration/update-day-type-rules";
import { setShiftDefinitions } from "../configuration/update-shift-definitions";
import { setSlotRequirements } from "../configuration/update-slot-requirements";
import { createRotationPool } from "../configuration/create-rotation-pool";
import { addPoolMembership } from "../configuration/update-pool-membership";
import {
  checkPlanVersionActivationReadiness,
  type ActivationIssue,
} from "../configuration/validate-plan-version-completeness";
import { activatePlanVersion } from "../configuration/activate-plan-version";
import { V1_DAY_TYPES, type V1DayType } from "../v1-adapter";

export type MigrateV1RegionToV2Input = {
  organizationId: string;
  regionId: string;
  userId: string;
};

export type MigrateV1RegionToV2Success = {
  ok: true;
  planId: string;
  versionId: string;
  poolId: string;
  memberCount: number;
  activated: boolean;
  activationBlockingIssues: ActivationIssue[];
};

export type MigrateV1RegionToV2ErrorCode =
  | "REGION_NOT_FOUND"
  | "NO_DUTY_RULE"
  | "ALREADY_HAS_PLAN";

export type MigrateV1RegionToV2Failure = {
  ok: false;
  code: MigrateV1RegionToV2ErrorCode;
  message: string;
};

export type MigrateV1RegionToV2Result = MigrateV1RegionToV2Success | MigrateV1RegionToV2Failure;

function fail(code: MigrateV1RegionToV2ErrorCode, message: string): MigrateV1RegionToV2Failure {
  return { ok: false, code, message };
}

const DAY_TYPE_WEIGHT: Record<
  V1DayType,
  (dutyRule: { weekdayWeight: number; saturdayWeight: number; sundayWeight: number; officialHolidayWeight: number; religiousHolidayWeight: number }) => number | null
> = {
  WEEKDAY: (r) => r.weekdayWeight,
  SATURDAY: (r) => r.saturdayWeight,
  SUNDAY: (r) => r.sundayWeight,
  OFFICIAL_HOLIDAY: (r) => r.officialHolidayWeight,
  RELIGIOUS_HOLIDAY: (r) => r.religiousHolidayWeight,
  // V1 does not distinguish holiday eves (v1-adapter.ts's own
  // distinctInV1: false) — left unconfigured rather than inventing a
  // value nothing in V1 ever produced.
  HOLIDAY_EVE: () => null,
};

export async function migrateV1RegionToV2(
  input: MigrateV1RegionToV2Input
): Promise<MigrateV1RegionToV2Result> {
  const { organizationId, regionId, userId } = input;

  const region = await prisma.region.findFirst({
    where: { id: regionId, organizationId },
    include: {
      dutyRule: true,
      pharmacies: { where: { isActive: true }, select: { id: true } },
    },
  });
  if (!region) {
    return fail("REGION_NOT_FOUND", "Bölge bulunamadı.");
  }
  if (!region.dutyRule) {
    return fail(
      "NO_DUTY_RULE",
      "Bu bölge için tanımlı bir V1 nöbet kuralı bulunamadığından taşınacak bir yapılandırma yok."
    );
  }

  const existingPlan = await prisma.dutyPlan.findFirst({
    where: { organizationId, regionId },
    select: { id: true },
  });
  if (existingPlan) {
    return fail(
      "ALREADY_HAS_PLAN",
      "Bu bölge için zaten bir V2 planı var. Mevcut planı Plan Yönetimi sayfasından düzenleyebilirsiniz."
    );
  }

  const dutyRule = region.dutyRule;

  const planResult = await createDutyPlan({
    organizationId,
    regionId,
    name: `${region.name} (V1'den taşındı)`,
    userId,
  });
  if (!planResult.ok) {
    throw new Error(`Beklenmeyen plan oluşturma hatası: ${planResult.code}`);
  }
  const { planId, versionId } = planResult;

  const dayTypeResult = await setDayTypeRules({
    organizationId,
    versionId,
    rules: V1_DAY_TYPES.map((dayType) => ({
      dayType,
      isServed: true,
      weight: DAY_TYPE_WEIGHT[dayType](dutyRule),
    })),
    userId,
  });
  if (!dayTypeResult.ok) {
    throw new Error(`Beklenmeyen gün tipi kuralı hatası: ${dayTypeResult.code}`);
  }

  const shiftResult = await setShiftDefinitions({
    organizationId,
    versionId,
    shifts: [
      {
        name: "V1 Günlük Nöbet",
        startMinute: 0,
        endMinute: 1439,
        spansMidnight: false,
        defaultWeight: 1,
        sortOrder: 0,
      },
    ],
    userId,
  });
  if (!shiftResult.ok) {
    throw new Error(`Beklenmeyen vardiya tanımı hatası: ${shiftResult.code}`);
  }

  const poolResult = await createRotationPool({
    organizationId,
    regionId,
    name: `${region.name} Havuzu (V1'den taşındı)`,
    strategy: "FAIRNESS_SCORE",
    userId,
  });
  if (!poolResult.ok) {
    throw new Error(`Beklenmeyen rotasyon havuzu hatası: ${poolResult.code}`);
  }
  const { poolId } = poolResult;

  const joinedAt = new Date().toISOString().slice(0, 10);
  let memberCount = 0;
  for (const pharmacy of region.pharmacies) {
    const added = await addPoolMembership({
      organizationId,
      poolId,
      pharmacyId: pharmacy.id,
      joinedAt,
      userId,
    });
    if (!added.ok) {
      throw new Error(`Beklenmeyen havuz üyeliği hatası: ${added.code}`);
    }
    memberCount += 1;
  }

  // No Phase 11 service manages RotationState — Phase 9's publish flow is
  // the only documented writer of currentRound/lockVersion progression.
  // A freshly migrated pool simply starts at round 0, exactly like every
  // other newly-created pool in this configuration surface (see the
  // Vakfıkebir/Akçaabat integration tests).
  await prisma.rotationState.create({
    data: { poolId, dayTypeScope: "ALL", currentRound: 0, lockVersion: 0 },
  });

  const dayTypeRules = await prisma.dayTypeRule.findMany({
    where: { planVersionId: versionId },
    select: { id: true, dayType: true },
  });
  const shift = await prisma.shiftDefinition.findFirstOrThrow({
    where: { planVersionId: versionId },
    select: { id: true },
  });

  const slotResult = await setSlotRequirements({
    organizationId,
    versionId,
    slots: dayTypeRules.map((rule, index) => ({
      dayTypeRuleId: rule.id,
      shiftDefinitionId: shift.id,
      rotationPoolId: poolId,
      requiredCount: region.dailyDutyCount,
      sortOrder: index,
    })),
    userId,
  });
  if (!slotResult.ok) {
    throw new Error(`Beklenmeyen slot gereksinimi hatası: ${slotResult.code}`);
  }

  const readiness = await checkPlanVersionActivationReadiness({
    organizationId,
    regionId,
    versionId,
  });
  if (!readiness.ok) {
    return {
      ok: true,
      planId,
      versionId,
      poolId,
      memberCount,
      activated: false,
      activationBlockingIssues: readiness.blockingIssues,
    };
  }

  const activation = await activatePlanVersion({
    organizationId,
    regionId,
    planVersionId: versionId,
    userId,
  });
  if (!activation.ok) {
    return {
      ok: true,
      planId,
      versionId,
      poolId,
      memberCount,
      activated: false,
      activationBlockingIssues: activation.blockingIssues ?? [],
    };
  }

  return {
    ok: true,
    planId,
    versionId,
    poolId,
    memberCount,
    activated: true,
    activationBlockingIssues: [],
  };
}
