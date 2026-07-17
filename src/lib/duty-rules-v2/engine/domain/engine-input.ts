// Duty Rules V2 engine — the runtime input contract (Phase 4, Phase 2 of
// the engine task).
//
// DutyEngineInput is a PLAIN, fully explicit contract: no Prisma models,
// no Date objects, no current timestamp, no database handles, no session
// objects, and no implicit organization/region defaults — the caller
// states everything, including the scheduling policy (the Phase 1 V2
// schema deliberately persists no weights or interval yet, so policy is
// explicit runtime input in compatibility mode; a later phase may move it
// into persisted configuration).

import { z } from "zod";

import type { LoadedDutyPlanVersion } from "../../domain/loaded-plan";
import type { ConfiguredRuleDefinition } from "../../rules/domain/rule-definition";
import type { ConfiguredSelectionStrategy } from "../../selection/domain/strategy-definition";
import { isIsoDateString } from "../domain/dates";

export type EngineGenerationMode = "PREVIEW" | "SIMULATION";

export type EngineHoliday = {
  date: string;
  name: string;
  /** OTHER is weighted as OFFICIAL — the documented V1 rule
   *  (generate-duty-schedule.ts:119-120), preserved verbatim. */
  type: "OFFICIAL" | "RELIGIOUS" | "OTHER";
};

export type EngineCustomDayOverride = {
  date: string;
  customDayCategory: string;
};

export type EngineUnavailability = {
  pharmacyId: string;
  startDate: string;
  endDate: string;
};

export type EngineDutyRequest = {
  pharmacyId: string;
  requestType: "CANNOT_DUTY" | "PREFER_DUTY" | "SWAP_REQUEST" | "EMERGENCY_EXCUSE";
  status: "PENDING" | "APPROVED" | "REJECTED" | "CANCELLED" | "LATE";
  startDate: string;
  endDate: string;
};

export type EngineHistoricalDuty = {
  pharmacyId: string;
  date: string;
  weight: number;
};

export type EngineBalanceAdjustment = {
  pharmacyId: string;
  amount: number;
};

/** An assignment that already exists in the requested period (manual
 *  pre-assignments, or previously committed rows in SIMULATION). */
export type EngineExistingAssignment = {
  pharmacyId: string;
  date: string;
  /** Engine slot key when known; null for legacy whole-day assignments. */
  slotKey: string | null;
  weight: number;
};

/** Explicit scheduling policy. Nothing here has a hidden default — in V1
 *  compatibility mode every value derives from the region's DutyRule via
 *  the Phase 2 adapter. */
export type EngineSchedulingPolicy = {
  minDaysBetweenDuties: number;
  /** V1's exact limited relaxation: relax ONLY the minimum-day interval
   *  when strictly-eligible candidates cannot fill the quota. */
  relaxMinIntervalWhenInsufficient: boolean;
  /** Weight per day-type key ("WEEKDAY", …, or "DAYTYPE|category"). */
  dayTypeWeights: { dayTypeKey: string; weight: number }[];
  /** When false, a second assignment on the same date (any slot) is a
   *  hard conflict — V1 semantics. When true, only the same slot is. */
  sameDaySecondAssignmentAllowed: boolean;
  /** Phase 6 corrective: explicit holiday-eve weight source.
   *  "CONFIGURED" (default when omitted) = use dayTypeWeights'
   *  HOLIDAY_EVE entry as-is — native V2 semantics, a chamber may
   *  configure any eve weight it wants. "UNDERLYING_WEEKDAY" = resolve
   *  the weight from the eve date's actual calendar weekday
   *  (WEEKDAY/SATURDAY/SUNDAY) instead, exactly matching V1 (which has
   *  no eve concept at all — see CalendarDayContext.compatibilityWeightDayType).
   *  Required for V1 compatibility equivalence; never a hidden default,
   *  never inferred. */
  holidayEveWeightSource?: "CONFIGURED" | "UNDERLYING_WEEKDAY";
  /** Phase 6 corrective: explicit holiday-overlap resolution mode for
   *  same-date RELIGIOUS+OFFICIAL(+OTHER) overlaps. "NATIVE_PRECEDENCE"
   *  (default when omitted) = deterministic, order-INDEPENDENT: the
   *  resolved day type (and therefore weight) always prefers
   *  RELIGIOUS_HOLIDAY over OFFICIAL_HOLIDAY, regardless of input array
   *  order — native V2 semantics, unaffected by this field.
   *  "V1_LAST_INPUT_WINS" = reproduces V1's actual behavior
   *  (generate-duty-schedule.ts's `holidayByDateKey` is a Map, so
   *  whichever holiday record appears LAST in the caller's `holidays`
   *  array wins for BOTH weight and note) — order-DEPENDENT by design,
   *  required for exact V1 weight equivalence when overlapping holidays
   *  exist. Never a hidden default, never inferred from string content. */
  holidayOverlapResolutionMode?: "NATIVE_PRECEDENCE" | "V1_LAST_INPUT_WINS";
};

export type DutyEngineInput = {
  loadedPlan: LoadedDutyPlanVersion;
  /** Must equal loadedPlan.organizationId / regionId — an explicit
   *  consistency assertion, never a source of scoping by itself. */
  organizationId: string;
  regionId: string;
  periodStart: string;
  periodEnd: string;
  generationMode: EngineGenerationMode;
  policy: EngineSchedulingPolicy;
  holidays: EngineHoliday[];
  customDayOverrides: EngineCustomDayOverride[];
  unavailability: EngineUnavailability[];
  dutyRequests: EngineDutyRequest[];
  historicalDuties: EngineHistoricalDuty[];
  balanceAdjustments: EngineBalanceAdjustment[];
  existingAssignments: EngineExistingAssignment[];
  /** Phase 5: explicit in-memory configured rules (no persistence yet).
   *  Omitted or empty = Phase 4 behavior, byte-identical. Validated and
   *  conflict-gated before any evaluation. */
  configuredRules?: ConfiguredRuleDefinition[];
  /** Phase 6: explicit in-memory configured selection strategies (no
   *  persistence yet). Omitted or empty = no provisional selections;
   *  Phase 4/5 evaluation (rules, eligibility, fairness/rotation facts)
   *  is otherwise byte-identical. Validated and conflict-gated before
   *  any ranking. */
  configuredSelectionStrategies?: ConfiguredSelectionStrategy[];
};

// ---------------------------------------------------------------------------
// Typed errors.
// ---------------------------------------------------------------------------

export type DutyEngineErrorCode =
  | "INVALID_INPUT"
  | "INVALID_PERIOD"
  | "ORGANIZATION_MISMATCH"
  | "REGION_MISMATCH"
  | "FOREIGN_PHARMACY"
  | "DUPLICATE_RUNTIME_RECORD"
  | "UNKNOWN_DAY_TYPE_WEIGHT";

export class DutyEngineError extends Error {
  constructor(
    public readonly code: DutyEngineErrorCode,
    message: string
  ) {
    super(message);
    this.name = "DutyEngineError";
  }
}

// ---------------------------------------------------------------------------
// Validation.
// ---------------------------------------------------------------------------

const isoDate = z.string().refine(isIsoDateString, { message: "YYYY-MM-DD bekleniyor" });

const inputSchema = z.object({
  organizationId: z.string().min(1),
  regionId: z.string().min(1),
  periodStart: isoDate,
  periodEnd: isoDate,
  generationMode: z.enum(["PREVIEW", "SIMULATION"]),
  policy: z.object({
    minDaysBetweenDuties: z.number().int().min(0),
    relaxMinIntervalWhenInsufficient: z.boolean(),
    dayTypeWeights: z.array(
      z.object({ dayTypeKey: z.string().min(1), weight: z.number().finite().positive() })
    ),
    sameDaySecondAssignmentAllowed: z.boolean(),
    holidayEveWeightSource: z.enum(["CONFIGURED", "UNDERLYING_WEEKDAY"]).optional(),
    holidayOverlapResolutionMode: z.enum(["NATIVE_PRECEDENCE", "V1_LAST_INPUT_WINS"]).optional(),
  }),
  holidays: z.array(
    z.object({
      date: isoDate,
      name: z.string().min(1),
      type: z.enum(["OFFICIAL", "RELIGIOUS", "OTHER"]),
    })
  ),
  customDayOverrides: z.array(
    z.object({ date: isoDate, customDayCategory: z.string().min(1) })
  ),
  unavailability: z.array(
    z.object({ pharmacyId: z.string().min(1), startDate: isoDate, endDate: isoDate })
  ),
  dutyRequests: z.array(
    z.object({
      pharmacyId: z.string().min(1),
      requestType: z.enum(["CANNOT_DUTY", "PREFER_DUTY", "SWAP_REQUEST", "EMERGENCY_EXCUSE"]),
      status: z.enum(["PENDING", "APPROVED", "REJECTED", "CANCELLED", "LATE"]),
      startDate: isoDate,
      endDate: isoDate,
    })
  ),
  historicalDuties: z.array(
    z.object({ pharmacyId: z.string().min(1), date: isoDate, weight: z.number().finite() })
  ),
  balanceAdjustments: z.array(
    z.object({ pharmacyId: z.string().min(1), amount: z.number().finite() })
  ),
  existingAssignments: z.array(
    z.object({
      pharmacyId: z.string().min(1),
      date: isoDate,
      slotKey: z.string().min(1).nullable(),
      weight: z.number().finite(),
    })
  ),
});

/** Longest supported evaluation period (inclusive), in days. */
export const MAX_PERIOD_DAYS = 366;

/**
 * Validate one DutyEngineInput. Throws DutyEngineError; on success the
 * input is structurally sound, tenant-consistent with the loaded plan,
 * duplicate-free, and every runtime pharmacyId belongs to the plan's
 * membership universe (temporal history included, so departed pharmacies
 * with historical records remain valid).
 */
export function validateEngineInput(input: DutyEngineInput): void {
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new DutyEngineError(
      "INVALID_INPUT",
      `Geçersiz motor girdisi: ${issue?.path.join(".") ?? "?"}`
    );
  }

  if (input.organizationId !== input.loadedPlan.organizationId) {
    throw new DutyEngineError("ORGANIZATION_MISMATCH", "Plan bu organizasyona ait değil.");
  }
  if (input.regionId !== input.loadedPlan.regionId) {
    throw new DutyEngineError("REGION_MISMATCH", "Plan bu bölgeye ait değil.");
  }
  if (input.periodStart > input.periodEnd) {
    throw new DutyEngineError("INVALID_PERIOD", "Dönem başlangıcı bitişten sonra olamaz.");
  }
  const periodMs =
    new Date(`${input.periodEnd}T00:00:00.000Z`).getTime() -
    new Date(`${input.periodStart}T00:00:00.000Z`).getTime();
  if (periodMs / (24 * 60 * 60 * 1000) + 1 > MAX_PERIOD_DAYS) {
    throw new DutyEngineError("INVALID_PERIOD", "Dönem desteklenen uzunluğu aşıyor.");
  }

  // Foreign pharmacies: every runtime pharmacyId must exist in the plan's
  // membership universe (all pools, all temporal rows).
  const knownPharmacyIds = new Set(
    input.loadedPlan.rotationPools.flatMap((pool) =>
      pool.memberships.map((membership) => membership.pharmacyId)
    )
  );
  const runtimePharmacyIds = [
    ...input.unavailability.map((r) => r.pharmacyId),
    ...input.dutyRequests.map((r) => r.pharmacyId),
    ...input.historicalDuties.map((r) => r.pharmacyId),
    ...input.balanceAdjustments.map((r) => r.pharmacyId),
    ...input.existingAssignments.map((r) => r.pharmacyId),
  ];
  for (const pharmacyId of runtimePharmacyIds) {
    if (!knownPharmacyIds.has(pharmacyId)) {
      throw new DutyEngineError("FOREIGN_PHARMACY", `Eczane (${pharmacyId}) bu plana yabancı.`);
    }
  }

  // Exact duplicates are caller mistakes, never silently deduplicated.
  assertNoDuplicates(input.holidays, (h) => `${h.date}|${h.type}|${h.name}`, "holiday");
  assertNoDuplicates(input.customDayOverrides, (o) => o.date, "customDayOverride");
  assertNoDuplicates(
    input.unavailability,
    (u) => `${u.pharmacyId}|${u.startDate}|${u.endDate}`,
    "unavailability"
  );
  assertNoDuplicates(
    input.dutyRequests,
    (r) => `${r.pharmacyId}|${r.requestType}|${r.status}|${r.startDate}|${r.endDate}`,
    "dutyRequest"
  );
  assertNoDuplicates(
    input.historicalDuties,
    (h) => `${h.pharmacyId}|${h.date}|${h.weight}`,
    "historicalDuty"
  );
  assertNoDuplicates(input.balanceAdjustments, (b) => b.pharmacyId, "balanceAdjustment");
  assertNoDuplicates(
    input.existingAssignments,
    (a) => `${a.pharmacyId}|${a.date}|${a.slotKey ?? ""}`,
    "existingAssignment"
  );
  assertNoDuplicates(input.policy.dayTypeWeights, (w) => w.dayTypeKey, "dayTypeWeight");

  for (const window of [...input.unavailability, ...input.dutyRequests]) {
    if (window.startDate > window.endDate) {
      throw new DutyEngineError("INVALID_INPUT", "Tarih aralığı başlangıcı bitişten sonra.");
    }
  }
}

function assertNoDuplicates<T>(items: T[], key: (item: T) => string, label: string): void {
  const seen = new Set<string>();
  for (const item of items) {
    const k = key(item);
    if (seen.has(k)) {
      throw new DutyEngineError(
        "DUPLICATE_RUNTIME_RECORD",
        `Yinelenen çalışma zamanı kaydı (${label}).`
      );
    }
    seen.add(k);
  }
}
