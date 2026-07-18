// Duty Rules V2 — Phase 12: Admin UI integration glue code for NATIVE
// policy mode.
//
// The sibling of assemble-v1-compatibility-engine-input.ts (Phase 10).
// That module always derives EngineSchedulingPolicy from the region's V1
// DutyRule row, which means a region with zero V1 history can never
// generate a V2 draft. This module derives the policy from the plan
// version's OWN persisted columns (DutyPlanVersion.minDaysBetweenDuties/
// relaxMinIntervalWhenInsufficient/sameDaySecondAssignmentAllowed/
// holidayEveWeightSource/holidayOverlapResolutionMode) and its own
// DayTypeRule.weight values instead — no DutyRule lookup at all.
//
// Everything else (tenant-scoped region/pharmacy validation, active-plan-
// version lookup, duplicate-schedule guard, the five runtime facts) is
// identical in spirit to the V1-compatibility assembler, and shares the
// exact same queries via fetch-engine-runtime-facts.ts.

import { prisma } from "@/lib/prisma";
import { loadDutyPlanVersion } from "../load-duty-plan-version";
import { DutyPlanLoaderError } from "../errors";
import type { DutyEngineInput, EngineSchedulingPolicy } from "../engine/domain/engine-input";
// buildCompatibilityRules / buildV1CompatibilitySelectionStrategy live
// under rules/ and selection/ respectively (both protected, unmodified
// here). Despite their "V1" naming, neither is actually V1-specific:
// buildCompatibilityRules(policy) only ever reads an already-built
// EngineSchedulingPolicy (whatever shape it has, native or compatibility)
// and projects it into ConfiguredRuleDefinitions; it has no DutyRule
// dependency and no V1-only branch. buildV1CompatibilitySelectionStrategy
// only consumes organizationId + regionId to scope a selection strategy —
// again nothing V1-specific. Both are reused as-is for native-policy mode;
// the "V1" in their names refers to the SEMANTICS they encode (the
// existing V1-equivalent constraint set), not a restriction on which
// policy source may drive them.
import { buildCompatibilityRules } from "../rules/build-compatibility-rules";
import { buildV1CompatibilitySelectionStrategy } from "../selection/build-v1-compatibility-strategy";
import { parseDateKey } from "../../scheduling/date-tr";
import { fetchEngineRuntimeFacts } from "./fetch-engine-runtime-facts";
import type { BuiltinDayType } from "../domain/loaded-plan";

export type AssembleNativeEngineInputParams = {
  organizationId: string;
  regionId: string;
  /** "YYYY-MM-DD" */
  periodStart: string;
  /** "YYYY-MM-DD" */
  periodEnd: string;
};

export type AssembleNativeEngineInputErrorCode =
  | "REGION_NOT_FOUND"
  | "NO_ACTIVE_PLAN_VERSION"
  | "POLICY_NOT_CONFIGURED"
  | "MISSING_DAY_TYPE_WEIGHT"
  | "NO_ACTIVE_PHARMACIES"
  | "INVALID_PERIOD"
  | "DUPLICATE_SCHEDULE_EXISTS";

export type AssembleNativeEngineInputResult =
  | { ok: true; input: DutyEngineInput; planVersionId: string }
  | { ok: false; code: AssembleNativeEngineInputErrorCode; message: string };

function fail(
  code: AssembleNativeEngineInputErrorCode,
  message: string
): AssembleNativeEngineInputResult {
  return { ok: false, code, message };
}

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const DAY_TYPE_LABELS_TR: Record<BuiltinDayType, string> = {
  WEEKDAY: "Hafta İçi",
  SATURDAY: "Cumartesi",
  SUNDAY: "Pazar",
  OFFICIAL_HOLIDAY: "Resmi Bayram",
  RELIGIOUS_HOLIDAY: "Dini Bayram",
  HOLIDAY_EVE: "Bayram Arifesi",
};

/**
 * Builds a real, DB-backed DutyEngineInput for the region's ACTIVE V2
 * plan version, in NATIVE-POLICY mode — i.e. the version's own persisted
 * policy columns and day-type weights, with NO dependency on a V1
 * DutyRule at all. Never trusts client-supplied data beyond
 * regionId/periodStart/periodEnd — organizationId is always
 * session-derived by the caller (a server action), and every other fact
 * is read fresh from the database.
 */
export async function assembleV2NativeEngineInput(
  params: AssembleNativeEngineInputParams
): Promise<AssembleNativeEngineInputResult> {
  const { organizationId, regionId, periodStart, periodEnd } = params;

  if (!ISO_DATE_PATTERN.test(periodStart) || !ISO_DATE_PATTERN.test(periodEnd)) {
    return fail("INVALID_PERIOD", "Dönem başlangıç/bitiş tarihleri geçersiz.");
  }
  const startDate = parseDateKey(periodStart);
  const endDate = parseDateKey(periodEnd);
  if (!startDate || !endDate || startDate > endDate) {
    return fail("INVALID_PERIOD", "Dönem başlangıcı bitişten sonra olamaz.");
  }

  // Tenant-scoped fetch: 404-equivalent for both "doesn't exist" and
  // "belongs to another organization" — same non-disclosure principle as
  // load-duty-plan-version.ts's PLAN_VERSION_NOT_FOUND. Deliberately does
  // NOT include dutyRule — a region with zero V1 history is fully
  // supported here.
  const region = await prisma.region.findFirst({
    where: { id: regionId, organizationId },
    include: {
      pharmacies: { where: { isActive: true }, select: { id: true } },
    },
  });
  if (!region) {
    return fail("REGION_NOT_FOUND", "Bölge bulunamadı.");
  }
  if (region.pharmacies.length === 0) {
    return fail(
      "NO_ACTIVE_PHARMACIES",
      "Bu bölgede aktif eczane bulunamadığı için taslak oluşturulamaz."
    );
  }

  const activeVersion = await prisma.dutyPlanVersion.findFirst({
    where: { plan: { organizationId, regionId }, status: "ACTIVE" },
    orderBy: { versionNumber: "desc" },
    include: {
      dayTypeRules: { select: { dayType: true, isServed: true, weight: true } },
    },
  });
  if (!activeVersion) {
    return fail(
      "NO_ACTIVE_PLAN_VERSION",
      "Bu bölge için etkin bir V2 nöbet planı bulunamadı. Önce bir plan sürümü etkinleştirilmelidir."
    );
  }

  if (activeVersion.minDaysBetweenDuties === null) {
    return fail(
      "POLICY_NOT_CONFIGURED",
      "Bu plan sürümü için nöbet politikası (asgari nöbet aralığı ve gün tipi ağırlıkları) henüz yapılandırılmamış."
    );
  }

  const missingWeightRule = activeVersion.dayTypeRules.find(
    (r) => r.isServed && r.weight === null
  );
  if (missingWeightRule) {
    const label = DAY_TYPE_LABELS_TR[missingWeightRule.dayType as BuiltinDayType];
    return fail(
      "MISSING_DAY_TYPE_WEIGHT",
      `"${label}" gün tipi nöbet tutuyor ancak bir ağırlık değeri tanımlanmamış.`
    );
  }

  // Duplicate-schedule guard: only meaningful (and checkable) when the
  // requested period maps onto exactly one calendar month — the same
  // granularity commit-complete-draft.ts itself requires. A multi-month
  // period simply proceeds here and is rejected later at commit time by
  // that service's own single-month check; duplicating that validation
  // here would be redundant, not safer.
  if (
    startDate.getUTCFullYear() === endDate.getUTCFullYear() &&
    startDate.getUTCMonth() === endDate.getUTCMonth()
  ) {
    const year = startDate.getUTCFullYear();
    const month = startDate.getUTCMonth() + 1;
    const existingSchedule = await prisma.dutySchedule.findUnique({
      where: { year_month_regionId: { year, month, regionId } },
    });
    if (existingSchedule) {
      return fail(
        "DUPLICATE_SCHEDULE_EXISTS",
        "Bu bölge için seçilen dönemde zaten bir nöbet çizelgesi mevcut."
      );
    }
  }

  let loadedPlan;
  try {
    loadedPlan = await loadDutyPlanVersion({
      organizationId,
      regionId,
      planVersionId: activeVersion.id,
    });
  } catch (error) {
    if (error instanceof DutyPlanLoaderError) {
      return fail(
        "NO_ACTIVE_PLAN_VERSION",
        "Etkin plan sürümü yüklenirken bir sorun oluştu: " + error.message
      );
    }
    throw error;
  }

  // dayTypeWeights: one entry per isServed:true row (all of which are
  // guaranteed non-null at this point by the MISSING_DAY_TYPE_WEIGHT
  // check above). DayTypeRule rows are already unique per
  // (planVersionId, dayType, customDayCategory), so using `dayType`
  // directly as dayTypeKey is naturally duplicate-free — mirrors how
  // assembleV1CompatibilityEngineInput keys its own dayTypeWeights.
  const dayTypeWeights = activeVersion.dayTypeRules
    .filter((r) => r.isServed)
    .map((r) => ({ dayTypeKey: r.dayType as string, weight: r.weight as number }));

  const policy: EngineSchedulingPolicy = {
    minDaysBetweenDuties: activeVersion.minDaysBetweenDuties,
    relaxMinIntervalWhenInsufficient: activeVersion.relaxMinIntervalWhenInsufficient,
    dayTypeWeights,
    sameDaySecondAssignmentAllowed: activeVersion.sameDaySecondAssignmentAllowed,
    holidayEveWeightSource: activeVersion.holidayEveWeightSource,
    holidayOverlapResolutionMode: activeVersion.holidayOverlapResolutionMode,
  };

  const pharmacyIds = region.pharmacies.map((p) => p.id);

  const { holidays, unavailability, dutyRequests, historicalDuties, balanceAdjustments } =
    await fetchEngineRuntimeFacts({
      organizationId,
      pharmacyIds,
      startDate,
      endDate,
    });

  const input: DutyEngineInput = {
    loadedPlan,
    organizationId,
    regionId,
    periodStart,
    periodEnd,
    generationMode: "PREVIEW",
    policy,
    holidays,
    customDayOverrides: [],
    unavailability,
    dutyRequests,
    historicalDuties,
    balanceAdjustments,
    existingAssignments: [],
    configuredRules: buildCompatibilityRules(policy),
    configuredSelectionStrategies: [
      buildV1CompatibilitySelectionStrategy({ organizationId, regionId }),
    ],
  };

  return { ok: true, input, planVersionId: activeVersion.id };
}
