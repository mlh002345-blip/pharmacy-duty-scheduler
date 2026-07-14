// Duty Rules V2 — Phase 2: V1 compatibility adapter.
//
// A PURE, DETERMINISTIC function that expresses the current V1
// configuration (DutyRule + Region + eligible pharmacies) as an
// in-memory V2-shaped configuration object, plus the reverse projection
// that reconstructs the exact V1 engine input back out of it.
//
// Hard boundaries (see docs/architecture/DUTY_RULES_V2_V1_ADAPTER.md):
//   - Never touches Prisma or the database; input and output are plain
//     serializable objects. No DutyPlan/DutyPlanVersion/... rows are
//     written anywhere.
//   - V1 (DutyRule + generate-duty-schedule.ts) remains the production
//     source of truth; nothing in the application calls this module.
//   - No chamber, city, province, or district is encoded here — every
//     value derives from the caller-supplied input.
//   - Deterministic: no randomness, no timestamps, no reliance on input
//     ordering. The same normalized input always produces byte-identical
//     canonical serialization.

import { z } from "zod";

import type {
  CandidatePharmacy,
  DutyRuleWeights,
} from "@/lib/scheduling/generate-duty-schedule";

export const V1_ADAPTER_VERSION = 1;

// ---------------------------------------------------------------------------
// Input contract (plain data, deliberately NOT Prisma model types).
// ---------------------------------------------------------------------------

export type V1AdapterInput = {
  organizationId: string;
  region: {
    id: string;
    organizationId: string;
    name: string;
    dailyDutyCount: number;
  };
  dutyRule: {
    id: string;
    regionId: string;
    minDaysBetweenDuties: number;
    weekdayWeight: number;
    saturdayWeight: number;
    sundayWeight: number;
    officialHolidayWeight: number;
    religiousHolidayWeight: number;
  };
  // Every pharmacy the caller considers part of this region's V1 world —
  // including inactive ones. The adapter (like the V1 engine itself,
  // generate-duty-schedule.ts:177) keeps only active, in-region
  // pharmacies as POOL MEMBERS; inactive ones are recorded as excluded
  // so no input is silently dropped.
  pharmacies: {
    id: string;
    name: string;
    isActive: boolean;
    regionId: string;
  }[];
};

// ---------------------------------------------------------------------------
// Output contract.
// ---------------------------------------------------------------------------

export const V1_DAY_TYPES = [
  "WEEKDAY",
  "SATURDAY",
  "SUNDAY",
  "OFFICIAL_HOLIDAY",
  "RELIGIOUS_HOLIDAY",
  "HOLIDAY_EVE",
] as const;
export type V1DayType = (typeof V1_DAY_TYPES)[number];

export type AdaptedDayTypeRule = {
  dayType: V1DayType;
  served: true;
  // True when V1 genuinely distinguishes this day type with its own
  // weight. HOLIDAY_EVE is NOT distinguished by V1 (an eve is weighted
  // as whatever calendar day it falls on — generate-duty-schedule.ts
  // resolveDutyWeight has no eve branch), so its weight is null and
  // distinctInV1 is false. No business difference is invented.
  distinctInV1: boolean;
  weight: number | null;
};

export type AdaptedV1PlanConfig = {
  adapterVersion: typeof V1_ADAPTER_VERSION;
  compatibility: {
    mode: true;
    source: "V1_DUTY_RULE";
    sourceRuleId: string;
    sourceRegionId: string;
    organizationId: string;
    // V1's Holiday.type "OTHER" is weighted with the official-holiday
    // weight (resolveDutyWeight, generate-duty-schedule.ts:119-120) —
    // recorded so the future V2 engine reproduces it exactly.
    otherHolidayWeightSource: "OFFICIAL_HOLIDAY";
  };
  plan: {
    key: string;
    name: string;
    regionId: string;
    organizationId: string;
  };
  version: {
    key: string;
    versionNumber: 1;
    status: "COMPATIBILITY";
    // V1 has no validity-period concept — a DutyRule simply applies.
    validFrom: null;
    validTo: null;
  };
  dayTypeRules: AdaptedDayTypeRule[];
  // Exactly one synthetic shift: V1 assigns whole days with NO time
  // semantics, so times are null rather than fabricated hours.
  shift: {
    key: string;
    name: "V1 Günlük Nöbet";
    startMinute: null;
    endMinute: null;
    spansMidnight: null;
  };
  // One slot per day type (stable, ordinal-keyed) — all carry the same
  // requiredCount because V1's dailyDutyCount applies uniformly.
  slotRequirements: {
    key: string;
    dayType: V1DayType;
    ordinal: 0;
    shiftKey: string;
    poolKey: string;
    requiredCount: number;
  }[];
  rotationPool: {
    key: string;
    strategy: "FAIRNESS_SCORE";
    // POOL MEMBERSHIP = active, in-region pharmacies (sorted by id).
    // Date-specific eligibility (unavailability, approved CANNOT_DUTY)
    // is deliberately NOT membership — it is per-date filtering, exactly
    // as in V1, and never removes a pharmacy from the pool.
    memberships: { pharmacyId: string; name: string }[];
    // Inactive/pool-excluded pharmacies, preserved so no input is
    // silently dropped and reports can explain exclusions.
    excluded: { pharmacyId: string; reason: "INACTIVE" }[];
  };
  fairness: {
    minDaysBetweenDuties: number;
    // V1 relaxes the minimum interval when a day cannot otherwise be
    // filled (generate-duty-schedule.ts:266-269).
    relaxMinIntervalWhenInsufficient: true;
    // Opening balance (historical duties + manual adjustments) seeds the
    // load score (generate-duty-schedule.ts:186).
    openingBalanceIncluded: true;
    // The exact V1 candidate ordering (generate-duty-schedule.ts:271-300),
    // in evaluation order.
    tieBreakers: readonly [
      "TOTAL_LOAD_SCORE",
      "APPROVED_PREFER_DUTY_REQUEST",
      "TOTAL_DUTIES",
      "WEEKEND_DUTIES_ON_WEEKENDS",
      "HOLIDAY_DUTIES_ON_HOLIDAYS",
      "OLDEST_LAST_DUTY_FIRST",
      "NAME_TR_LOCALE",
    ];
  };
  eligibility: {
    onlyActivePharmacies: true;
    unavailabilityBlocksDate: true;
    approvedCannotDutyBlocksDate: true;
    approvedEmergencyExcuseBlocksDate: true;
    approvedPreferDutyPrioritizesOnEqualLoad: true;
  };
};

// ---------------------------------------------------------------------------
// Errors: controlled, typed, id-only (never pharmacy/pharmacist names or
// any other content in messages).
// ---------------------------------------------------------------------------

export type V1AdapterErrorCode =
  | "ORGANIZATION_REGION_MISMATCH"
  | "RULE_REGION_MISMATCH"
  | "PHARMACY_REGION_MISMATCH"
  | "DUPLICATE_PHARMACY"
  | "INVALID_REQUIRED_COUNT"
  | "INVALID_WEIGHT"
  | "INVALID_MIN_INTERVAL"
  | "INVALID_INPUT_SHAPE";

export class V1AdapterError extends Error {
  constructor(
    public readonly code: V1AdapterErrorCode,
    message: string
  ) {
    super(message);
    this.name = "V1AdapterError";
  }
}

const positiveFiniteWeight = z.number().finite().positive();

const inputSchema = z.object({
  organizationId: z.string().min(1),
  region: z.object({
    id: z.string().min(1),
    organizationId: z.string().min(1),
    name: z.string().min(1),
    dailyDutyCount: z.number().int().min(1),
  }),
  dutyRule: z.object({
    id: z.string().min(1),
    regionId: z.string().min(1),
    minDaysBetweenDuties: z.number().int().min(0),
    weekdayWeight: positiveFiniteWeight,
    saturdayWeight: positiveFiniteWeight,
    sundayWeight: positiveFiniteWeight,
    officialHolidayWeight: positiveFiniteWeight,
    religiousHolidayWeight: positiveFiniteWeight,
  }),
  pharmacies: z.array(
    z.object({
      id: z.string().min(1),
      name: z.string().min(1),
      isActive: z.boolean(),
      regionId: z.string().min(1),
    })
  ),
});

// ---------------------------------------------------------------------------
// The adapter.
// ---------------------------------------------------------------------------

export function adaptV1RuleToV2Config(rawInput: V1AdapterInput): AdaptedV1PlanConfig {
  const parsed = inputSchema.safeParse(rawInput);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const code: V1AdapterErrorCode =
      issue?.path.includes("dailyDutyCount")
        ? "INVALID_REQUIRED_COUNT"
        : issue?.path.includes("minDaysBetweenDuties")
          ? "INVALID_MIN_INTERVAL"
          : issue?.path.join(".").includes("Weight")
            ? "INVALID_WEIGHT"
            : "INVALID_INPUT_SHAPE";
    throw new V1AdapterError(code, `Geçersiz V1 girdisi: ${issue?.path.join(".") ?? "?"}`);
  }
  const input = parsed.data;

  if (input.region.organizationId !== input.organizationId) {
    throw new V1AdapterError(
      "ORGANIZATION_REGION_MISMATCH",
      `Bölge (${input.region.id}) bu organizasyona ait değil.`
    );
  }
  if (input.dutyRule.regionId !== input.region.id) {
    throw new V1AdapterError(
      "RULE_REGION_MISMATCH",
      `Nöbet kuralı (${input.dutyRule.id}) bu bölgeye ait değil.`
    );
  }
  const seen = new Set<string>();
  for (const pharmacy of input.pharmacies) {
    if (pharmacy.regionId !== input.region.id) {
      throw new V1AdapterError(
        "PHARMACY_REGION_MISMATCH",
        `Eczane (${pharmacy.id}) bu bölgeye ait değil.`
      );
    }
    if (seen.has(pharmacy.id)) {
      throw new V1AdapterError("DUPLICATE_PHARMACY", `Eczane (${pharmacy.id}) girdide yinelenmiş.`);
    }
    seen.add(pharmacy.id);
  }

  const { region, dutyRule } = input;
  const planKey = `v1-plan:${region.id}`;
  const versionKey = `v1-version:${dutyRule.id}:v${V1_ADAPTER_VERSION}`;
  const shiftKey = `v1-shift:${region.id}`;
  const poolKey = `v1-pool:${region.id}`;

  const dayTypeWeight: Record<V1DayType, number | null> = {
    WEEKDAY: dutyRule.weekdayWeight,
    SATURDAY: dutyRule.saturdayWeight,
    SUNDAY: dutyRule.sundayWeight,
    OFFICIAL_HOLIDAY: dutyRule.officialHolidayWeight,
    RELIGIOUS_HOLIDAY: dutyRule.religiousHolidayWeight,
    HOLIDAY_EVE: null, // V1 does not distinguish holiday eves.
  };

  const members = input.pharmacies
    .filter((p) => p.isActive)
    .map((p) => ({ pharmacyId: p.id, name: p.name }))
    .sort((a, b) => (a.pharmacyId < b.pharmacyId ? -1 : a.pharmacyId > b.pharmacyId ? 1 : 0));
  const excluded = input.pharmacies
    .filter((p) => !p.isActive)
    .map((p) => ({ pharmacyId: p.id, reason: "INACTIVE" as const }))
    .sort((a, b) => (a.pharmacyId < b.pharmacyId ? -1 : a.pharmacyId > b.pharmacyId ? 1 : 0));

  return {
    adapterVersion: V1_ADAPTER_VERSION,
    compatibility: {
      mode: true,
      source: "V1_DUTY_RULE",
      sourceRuleId: dutyRule.id,
      sourceRegionId: region.id,
      organizationId: input.organizationId,
      otherHolidayWeightSource: "OFFICIAL_HOLIDAY",
    },
    plan: {
      key: planKey,
      name: region.name,
      regionId: region.id,
      organizationId: input.organizationId,
    },
    version: {
      key: versionKey,
      versionNumber: 1,
      status: "COMPATIBILITY",
      validFrom: null,
      validTo: null,
    },
    dayTypeRules: V1_DAY_TYPES.map((dayType) => ({
      dayType,
      served: true,
      distinctInV1: dayType !== "HOLIDAY_EVE",
      weight: dayTypeWeight[dayType],
    })),
    shift: {
      key: shiftKey,
      name: "V1 Günlük Nöbet",
      startMinute: null,
      endMinute: null,
      spansMidnight: null,
    },
    slotRequirements: V1_DAY_TYPES.map((dayType) => ({
      key: `v1-slot:${dayType}:0`,
      dayType,
      ordinal: 0 as const,
      shiftKey,
      poolKey,
      requiredCount: region.dailyDutyCount,
    })),
    rotationPool: {
      key: poolKey,
      strategy: "FAIRNESS_SCORE",
      memberships: members,
      excluded,
    },
    fairness: {
      minDaysBetweenDuties: dutyRule.minDaysBetweenDuties,
      relaxMinIntervalWhenInsufficient: true,
      openingBalanceIncluded: true,
      tieBreakers: [
        "TOTAL_LOAD_SCORE",
        "APPROVED_PREFER_DUTY_REQUEST",
        "TOTAL_DUTIES",
        "WEEKEND_DUTIES_ON_WEEKENDS",
        "HOLIDAY_DUTIES_ON_HOLIDAYS",
        "OLDEST_LAST_DUTY_FIRST",
        "NAME_TR_LOCALE",
      ] as const,
    },
    eligibility: {
      onlyActivePharmacies: true,
      unavailabilityBlocksDate: true,
      approvedCannotDutyBlocksDate: true,
      approvedEmergencyExcuseBlocksDate: true,
      approvedPreferDutyPrioritizesOnEqualLoad: true,
    },
  };
}

// ---------------------------------------------------------------------------
// Adapted-config validation (structural invariants of the OUTPUT).
// ---------------------------------------------------------------------------

export type AdaptedConfigIssue = { code: string; detail: string };

export function validateAdaptedConfig(config: AdaptedV1PlanConfig): AdaptedConfigIssue[] {
  const issues: AdaptedConfigIssue[] = [];

  const dayTypes = new Set(config.dayTypeRules.map((r) => r.dayType));
  for (const required of V1_DAY_TYPES) {
    if (!dayTypes.has(required)) issues.push({ code: "MISSING_DAY_TYPE", detail: required });
  }

  const keys = [
    config.plan.key,
    config.version.key,
    config.shift.key,
    config.rotationPool.key,
    ...config.slotRequirements.map((s) => s.key),
  ];
  const seenKeys = new Set<string>();
  for (const key of keys) {
    if (seenKeys.has(key)) issues.push({ code: "DUPLICATE_KEY", detail: key });
    seenKeys.add(key);
  }

  for (const slot of config.slotRequirements) {
    if (slot.requiredCount < 1) issues.push({ code: "INVALID_REQUIRED_COUNT", detail: slot.key });
    if (slot.shiftKey !== config.shift.key) issues.push({ code: "UNKNOWN_SHIFT", detail: slot.key });
    if (slot.poolKey !== config.rotationPool.key) issues.push({ code: "UNKNOWN_POOL", detail: slot.key });
  }

  const memberIds = new Set<string>();
  for (const membership of config.rotationPool.memberships) {
    if (memberIds.has(membership.pharmacyId)) {
      issues.push({ code: "DUPLICATE_MEMBERSHIP", detail: membership.pharmacyId });
    }
    memberIds.add(membership.pharmacyId);
  }

  for (const rule of config.dayTypeRules) {
    if (rule.distinctInV1 && (rule.weight === null || !(rule.weight > 0))) {
      issues.push({ code: "INVALID_WEIGHT", detail: rule.dayType });
    }
  }
  if (config.fairness.minDaysBetweenDuties < 0) {
    issues.push({ code: "INVALID_MIN_INTERVAL", detail: String(config.fairness.minDaysBetweenDuties) });
  }

  return issues;
}

// ---------------------------------------------------------------------------
// Reverse compatibility projection: reconstruct the exact V1 engine
// configuration from the adapted config. Runtime data (month, holidays,
// unavailabilities, history, requests) is not part of the configuration
// and passes through the V1 engine unchanged, so it is not round-tripped
// here.
// ---------------------------------------------------------------------------

export type ReconstructedV1Config = {
  regionId: string;
  dailyDutyCount: number;
  dutyRule: DutyRuleWeights;
  pharmacies: CandidatePharmacy[];
};

export function projectAdaptedConfigToV1(config: AdaptedV1PlanConfig): ReconstructedV1Config {
  const weightOf = (dayType: V1DayType): number => {
    const rule = config.dayTypeRules.find((r) => r.dayType === dayType);
    if (!rule || rule.weight === null) {
      throw new V1AdapterError("INVALID_WEIGHT", `Gün türü ağırlığı eksik: ${dayType}`);
    }
    return rule.weight;
  };

  const counts = new Set(config.slotRequirements.map((s) => s.requiredCount));
  if (counts.size !== 1) {
    throw new V1AdapterError(
      "INVALID_REQUIRED_COUNT",
      "V1 uyumluluk yapılandırmasında tüm slot gereksinimleri aynı sayıda olmalıdır."
    );
  }

  return {
    regionId: config.plan.regionId,
    dailyDutyCount: config.slotRequirements[0].requiredCount,
    dutyRule: {
      minDaysBetweenDuties: config.fairness.minDaysBetweenDuties,
      weekdayWeight: weightOf("WEEKDAY"),
      saturdayWeight: weightOf("SATURDAY"),
      sundayWeight: weightOf("SUNDAY"),
      officialHolidayWeight: weightOf("OFFICIAL_HOLIDAY"),
      religiousHolidayWeight: weightOf("RELIGIOUS_HOLIDAY"),
    },
    pharmacies: config.rotationPool.memberships.map((membership) => ({
      id: membership.pharmacyId,
      name: membership.name,
      isActive: true,
      regionId: config.plan.regionId,
    })),
  };
}

// ---------------------------------------------------------------------------
// Canonical serialization: byte-stable output for equality/hash checks —
// object keys sorted recursively, no timestamps, no locale dependence.
// ---------------------------------------------------------------------------

export function canonicalSerialize(value: unknown): string {
  return JSON.stringify(sortKeysDeep(value));
}

function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
      a < b ? -1 : a > b ? 1 : 0
    );
    return Object.fromEntries(entries.map(([k, v]) => [k, sortKeysDeep(v)]));
  }
  return value;
}
