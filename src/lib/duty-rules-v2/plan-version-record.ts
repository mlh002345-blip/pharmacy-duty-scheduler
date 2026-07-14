// Duty Rules V2 — Phase 3: the internal persistence DTO.
//
// This is the ONLY shape that crosses the repository boundary — a plain,
// explicitly-typed snapshot of one DutyPlanVersion graph as persisted.
// It deliberately mirrors the database (Date objects, raw enum strings,
// denormalized ownership columns) so that:
//   - the repository can produce it from one scoped Prisma query,
//   - validators and the domain transformer stay PURE (unit-testable
//     without PostgreSQL by constructing records in memory),
//   - no raw Prisma result object ever leaves the repository module.
//
// Audit note: only DutyPlanVersion.updatedAt is carried (used by tests to
// prove the fingerprint ignores audit timestamps). Child createdAt /
// updatedAt columns are not even selected — they play no role in
// loading, validation, or determinism.

export type PlanVersionRecord = {
  id: string;
  versionNumber: number;
  status: string;
  validFrom: Date;
  validTo: Date | null;
  updatedAt: Date;
  plan: {
    id: string;
    name: string;
    organizationId: string;
    regionId: string;
    region: {
      id: string;
      organizationId: string;
      isActive: boolean;
    };
  };
  dayTypeRules: DayTypeRuleRecord[];
  shiftDefinitions: ShiftDefinitionRecord[];
  /** Every DISTINCT pool referenced by this version's slot requirements. */
  rotationPools: RotationPoolRecord[];
};

export type DayTypeRuleRecord = {
  id: string;
  dayType: string;
  isServed: boolean;
  customDayCategory: string | null;
  slotRequirements: SlotRequirementRecord[];
};

export type SlotRequirementRecord = {
  id: string;
  name: string | null;
  requiredCount: number;
  sortOrder: number;
  dayTypeRuleId: string;
  shiftDefinitionId: string;
  rotationPoolId: string | null;
};

export type ShiftDefinitionRecord = {
  id: string;
  name: string;
  startMinute: number;
  endMinute: number;
  spansMidnight: boolean;
  defaultWeight: number;
  sortOrder: number;
};

export type RotationPoolRecord = {
  id: string;
  name: string;
  strategy: string;
  organizationId: string;
  regionId: string | null;
  memberships: PoolMembershipRecord[];
  rotationStates: RotationStateRecord[];
};

export type PoolMembershipRecord = {
  id: string;
  pharmacyId: string;
  joinedAt: Date;
  leftAt: Date | null;
  sortIndex: number | null;
  pharmacy: {
    id: string;
    name: string;
    isActive: boolean;
    regionId: string;
    /** Pharmacy ownership derives through its region (Pharmacy has no
     *  organizationId column) — carried here for tenant validation. */
    regionOrganizationId: string;
  };
};

export type RotationStateRecord = {
  id: string;
  dayTypeScope: string;
  currentRound: number;
  carriedForward: unknown;
  lockVersion: number;
  lastServedMembershipId: string | null;
};

/** Normalize a persisted DateTime to its UTC calendar day ("YYYY-MM-DD").
 *  All calendar semantics in this codebase persist dates as UTC-midnight
 *  DateTimes; normalizing through UTC keeps the loader independent of the
 *  server's local time zone. */
export function toIsoDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}
