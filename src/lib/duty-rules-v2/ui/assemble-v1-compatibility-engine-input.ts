// Duty Rules V2 — Phase 10: Admin UI integration glue code.
//
// This module is NOT part of the Phase 2-9 engine/persistence pipeline —
// it is the ONLY supported way, in this phase, to build a real
// DutyEngineInput from persisted data for the admin "V2 Taslak Oluştur"
// flow. It always runs in V1-COMPATIBILITY mode: the scheduling policy
// is derived verbatim from the region's existing DutyRule (weights,
// minimum interval), exactly as V1's generate-and-save-duty-schedule.ts
// derives its own policy — Duty Rules V2's own persisted rule/strategy
// configuration surface (Phase 5/6 catalogues beyond the compatibility
// projection) is a future phase, not exposed here.
//
// IMPORTANT LIMITATION (see CLAUDE.md — build step by step, no UI for
// out-of-scope features): this function requires the region to already
// have an ACTIVE DutyPlanVersion (bootstrapped some other way — see
// scripts/duty-rules-v2-demo/seed-bilecik-and-run-demo.ts for the only
// bootstrap path that exists today). There is deliberately NO admin UI
// in this phase for creating/activating a plan version — every region
// without one simply returns NO_ACTIVE_PLAN_VERSION until a future phase
// adds that management UI.

import { prisma } from "@/lib/prisma";
import { loadDutyPlanVersion } from "../load-duty-plan-version";
import { DutyPlanLoaderError } from "../errors";
import type {
  DutyEngineInput,
  EngineBalanceAdjustment,
  EngineDutyRequest,
  EngineHistoricalDuty,
  EngineHoliday,
  EngineSchedulingPolicy,
  EngineUnavailability,
} from "../engine/domain/engine-input";
import { buildCompatibilityRules } from "../rules/build-compatibility-rules";
import { buildV1CompatibilitySelectionStrategy } from "../selection/build-v1-compatibility-strategy";
import { toIsoDate } from "../plan-version-record";
import { parseDateKey } from "../../scheduling/date-tr";

export type AssembleEngineInputParams = {
  organizationId: string;
  regionId: string;
  /** "YYYY-MM-DD" */
  periodStart: string;
  /** "YYYY-MM-DD" */
  periodEnd: string;
};

export type AssembleEngineInputErrorCode =
  | "REGION_NOT_FOUND"
  | "NO_DUTY_RULE"
  | "NO_ACTIVE_PLAN_VERSION"
  | "NO_ACTIVE_PHARMACIES"
  | "INVALID_PERIOD"
  | "DUPLICATE_SCHEDULE_EXISTS";

export type AssembleEngineInputResult =
  | { ok: true; input: DutyEngineInput; planVersionId: string }
  | { ok: false; code: AssembleEngineInputErrorCode; message: string };

function fail(
  code: AssembleEngineInputErrorCode,
  message: string
): AssembleEngineInputResult {
  return { ok: false, code, message };
}

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Builds a real, DB-backed DutyEngineInput for the region's ACTIVE V2
 * plan version, in V1-compatibility mode. Never trusts client-supplied
 * data beyond regionId/periodStart/periodEnd — organizationId is always
 * session-derived by the caller (a server action), and every other fact
 * (dutyRule, holidays, unavailability, duty requests, historical
 * assignments, balance adjustments) is read fresh from the database.
 */
export async function assembleV1CompatibilityEngineInput(
  params: AssembleEngineInputParams
): Promise<AssembleEngineInputResult> {
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
  // load-duty-plan-version.ts's PLAN_VERSION_NOT_FOUND.
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
    return fail("NO_DUTY_RULE", "Bu bölge için tanımlı bir nöbet kuralı bulunamadı.");
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
  });
  if (!activeVersion) {
    return fail(
      "NO_ACTIVE_PLAN_VERSION",
      "Bu bölge için etkin bir V2 nöbet planı bulunamadı. Önce bir plan sürümü etkinleştirilmelidir."
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

  // Phase 6 corrective HOLIDAY_EVE weight: V1 has no eve concept at all,
  // so UNDERLYING_WEEKDAY mode resolves an eve date's weight from its
  // actual calendar weekday instead — the only mode that reproduces V1
  // byte-for-byte. Because of that, the HOLIDAY_EVE entry in
  // dayTypeWeights below is never actually read for weighting purposes;
  // it is populated with the weekday weight only so the policy schema's
  // one-entry-per-day-type expectation is satisfied, per
  // engine-input.ts:82-91's documented reasoning.
  const policy: EngineSchedulingPolicy = {
    minDaysBetweenDuties: region.dutyRule.minDaysBetweenDuties,
    relaxMinIntervalWhenInsufficient: true,
    dayTypeWeights: [
      { dayTypeKey: "WEEKDAY", weight: region.dutyRule.weekdayWeight },
      { dayTypeKey: "SATURDAY", weight: region.dutyRule.saturdayWeight },
      { dayTypeKey: "SUNDAY", weight: region.dutyRule.sundayWeight },
      { dayTypeKey: "OFFICIAL_HOLIDAY", weight: region.dutyRule.officialHolidayWeight },
      { dayTypeKey: "RELIGIOUS_HOLIDAY", weight: region.dutyRule.religiousHolidayWeight },
      { dayTypeKey: "HOLIDAY_EVE", weight: region.dutyRule.weekdayWeight },
    ],
    sameDaySecondAssignmentAllowed: false,
    holidayEveWeightSource: "UNDERLYING_WEEKDAY",
  };

  const pharmacyIds = region.pharmacies.map((p) => p.id);

  const [holidayRows, unavailabilityRows, dutyRequestRows, historicalRows, balanceRows] =
    await Promise.all([
      prisma.holiday.findMany({
        where: { date: { gte: startDate, lte: endDate } },
      }),
      prisma.unavailability.findMany({
        where: {
          pharmacyId: { in: pharmacyIds },
          startDate: { lte: endDate },
          endDate: { gte: startDate },
        },
      }),
      // Only APPROVED requests affect generation — mirrors V1's own
      // generate-and-save-duty-schedule.ts filter exactly.
      prisma.dutyRequest.findMany({
        where: {
          pharmacyId: { in: pharmacyIds },
          status: "APPROVED",
          startDate: { lte: endDate },
          endDate: { gte: startDate },
        },
      }),
      // Prior COMMITTED assignments strictly before the period start —
      // the Phase-10 interpretation of "historical duties" for fairness/
      // tie-break purposes, analogous to V1's own historicalAssignments
      // input (generate-and-save-duty-schedule.ts's `date: { lt: monthStart }`
      // query). Not a Phase 2-9 concept being re-derived — Engine
      // input's historicalDuties field is documented as
      // caller-supplied fact, and this is this caller's own definition
      // of "prior history" for the region's pharmacies.
      prisma.dutyAssignment.findMany({
        where: {
          pharmacyId: { in: pharmacyIds },
          date: { lt: startDate },
        },
        select: { pharmacyId: true, date: true, weight: true },
        orderBy: { date: "asc" },
      }),
      prisma.dutyBalanceAdjustment.findMany({
        where: { pharmacyId: { in: pharmacyIds } },
        select: { pharmacyId: true, points: true },
      }),
    ]);

  const holidays: EngineHoliday[] = holidayRows.map((h) => ({
    date: toIsoDate(h.date),
    name: h.name,
    type: h.type,
  }));

  const unavailability: EngineUnavailability[] = unavailabilityRows.map((u) => ({
    pharmacyId: u.pharmacyId,
    startDate: toIsoDate(u.startDate),
    endDate: toIsoDate(u.endDate),
  }));

  const dutyRequests: EngineDutyRequest[] = dutyRequestRows.map((r) => ({
    pharmacyId: r.pharmacyId,
    requestType: r.requestType,
    status: r.status,
    startDate: toIsoDate(r.startDate),
    endDate: toIsoDate(r.endDate),
  }));

  const historicalDuties: EngineHistoricalDuty[] = historicalRows.map((a) => ({
    pharmacyId: a.pharmacyId,
    date: toIsoDate(a.date),
    weight: a.weight,
  }));

  // EngineBalanceAdjustment aggregates per pharmacy (the engine input
  // schema forbids duplicate pharmacyId entries in balanceAdjustments) —
  // sum every DutyBalanceAdjustment.points row per pharmacy, mirroring
  // getOpeningBalanceByPharmacy's own aggregation used by V1.
  const balanceByPharmacy = new Map<string, number>();
  for (const row of balanceRows) {
    balanceByPharmacy.set(
      row.pharmacyId,
      (balanceByPharmacy.get(row.pharmacyId) ?? 0) + row.points
    );
  }
  const balanceAdjustments: EngineBalanceAdjustment[] = [...balanceByPharmacy.entries()].map(
    ([pharmacyId, amount]) => ({ pharmacyId, amount })
  );

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
