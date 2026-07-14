// Duty Rules V2 — Phase 3: the engine-ready read model.
//
// A LoadedDutyPlanVersion is a PLAIN, fully-validated, deterministic
// domain object — never a Prisma model. It contains only what is needed
// to understand (and, in a later phase, execute) one persisted plan
// version for one organization and one region:
//   - no Prisma Date objects (calendar dates are "YYYY-MM-DD" strings),
//   - no createdAt/updatedAt audit timestamps at all,
//   - no fields copied merely because they exist in the database.
//
// Determinism: every array is explicitly sorted (see
// load-duty-plan-version.ts for the exact rules), so the same database
// state always produces byte-identical canonical serialization and the
// same fingerprint, regardless of Prisma relation ordering, row order,
// insertion order, or query planner order.

/** Mirrors the DutyPlanVersionStatus enum WITHOUT exposing Prisma types. */
export const DUTY_PLAN_VERSION_STATUSES = [
  "DRAFT",
  "UNDER_REVIEW",
  "APPROVED",
  "ACTIVE",
  "RETIRED",
  "ARCHIVED",
] as const;
export type DutyPlanVersionStatusValue = (typeof DUTY_PLAN_VERSION_STATUSES)[number];

/** Mirrors the DutyDayType enum, in canonical (declaration) order. */
export const BUILTIN_DAY_TYPES = [
  "WEEKDAY",
  "SATURDAY",
  "SUNDAY",
  "OFFICIAL_HOLIDAY",
  "RELIGIOUS_HOLIDAY",
  "HOLIDAY_EVE",
] as const;
export type BuiltinDayType = (typeof BUILTIN_DAY_TYPES)[number];

/** Mirrors the RotationStrategy enum WITHOUT exposing Prisma types. */
export const ROTATION_STRATEGIES = [
  "SEQUENTIAL",
  "FAIRNESS_SCORE",
  "WEIGHTED",
  "MANUAL_ORDER",
] as const;
export type RotationStrategyValue = (typeof ROTATION_STRATEGIES)[number];

/** A calendar date normalized to "YYYY-MM-DD" (UTC calendar day). */
export type IsoDateString = string;

export type LoadedDayTypeRule = {
  id: string;
  dayType: BuiltinDayType;
  isServed: boolean;
  customDayCategory: string | null;
};

export type LoadedShiftDefinition = {
  id: string;
  name: string;
  startMinute: number;
  endMinute: number;
  spansMidnight: boolean;
  defaultWeight: number;
  sortOrder: number;
};

export type LoadedSlotRequirement = {
  id: string;
  name: string | null;
  requiredCount: number;
  sortOrder: number;
  dayTypeRuleId: string;
  shiftDefinitionId: string;
  /** NULL is persisted as "default pool semantics" — surfaced verbatim,
   *  never silently substituted with a pool (no hidden defaults). */
  rotationPoolId: string | null;
};

export type LoadedPoolMembership = {
  id: string;
  pharmacyId: string;
  /** Pharmacy name is scheduling-relevant (Turkish-locale tie-breaks). */
  pharmacyName: string;
  pharmacyIsActive: boolean;
  /** Inclusive membership start (see resolve-pool-membership.ts). */
  joinedOn: IsoDateString;
  /** EXCLUSIVE membership end; null = open membership. */
  leftOn: IsoDateString | null;
  sortIndex: number | null;
};

export type LoadedRotationState = {
  id: string;
  dayTypeScope: string;
  currentRound: number;
  lockVersion: number;
  /** Validated via the existing carriedForward schema (rotation-state.ts). */
  carriedForward: { membershipId: string; reason: "SKIPPED" | "UNAVAILABLE"; periodKey: string }[];
  lastServedMembershipId: string | null;
};

export type LoadedRotationPool = {
  id: string;
  name: string;
  strategy: RotationStrategyValue;
  /** null = organization-wide pool (validated against the plan's org). */
  regionId: string | null;
  memberships: LoadedPoolMembership[];
  rotationStates: LoadedRotationState[];
};

export type LoaderDiagnosticCode =
  | "REGION_INACTIVE"
  | "SLOT_ON_UNSERVED_DAY_TYPE"
  | "SERVED_DAY_TYPE_WITHOUT_SLOTS"
  | "SLOT_WITHOUT_POOL"
  | "EFFECTIVE_DATE_OUTSIDE_VALIDITY"
  | "POOL_EMPTY_AS_OF_EFFECTIVE_DATE";

/** Non-fatal, deterministic-ordered observations about the loaded plan. */
export type LoaderDiagnostic = {
  code: LoaderDiagnosticCode;
  /** Record id or stable key — ids only, never tenant content. */
  subjectId: string;
};

export type ResolvedPoolMembershipSnapshot = {
  poolId: string;
  effectiveDate: IsoDateString;
  /** Deterministically ordered (sortIndex asc nulls-last, then pharmacyId). */
  eligible: { membershipId: string; pharmacyId: string; sortIndex: number | null }[];
  excluded: {
    membershipId: string;
    pharmacyId: string;
    reason: "NOT_YET_JOINED" | "LEFT_BEFORE_EFFECTIVE_DATE" | "PHARMACY_INACTIVE";
  }[];
};

export type LoadedDutyPlanVersion = {
  loaderVersion: number;
  organizationId: string;
  regionId: string;
  planId: string;
  planName: string;
  planVersionId: string;
  versionNumber: number;
  status: DutyPlanVersionStatusValue;
  validFrom: IsoDateString;
  validTo: IsoDateString | null;
  /** sha256 over scheduling-relevant configuration ONLY — see
   *  computeConfigurationFingerprint in load-duty-plan-version.ts for the
   *  exact field list. Audit timestamps, status, rotation-state
   *  progression, and diagnostics deliberately do NOT participate. */
  configurationFingerprint: string;
  dayTypeRules: LoadedDayTypeRule[];
  shiftDefinitions: LoadedShiftDefinition[];
  slotRequirements: LoadedSlotRequirement[];
  rotationPools: LoadedRotationPool[];
  /** Present only when the caller supplied an effectiveDate. */
  membershipSnapshots: ResolvedPoolMembershipSnapshot[] | null;
  diagnostics: LoaderDiagnostic[];
};
