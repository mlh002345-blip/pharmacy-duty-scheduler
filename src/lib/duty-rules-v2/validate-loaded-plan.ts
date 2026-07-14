// Duty Rules V2 — Phase 3: pure validation over the persistence DTO.
//
// Two independent, PURE validation passes (no Prisma, no I/O):
//
//   1. validateTenantIntegrity — every cross-tenant reference the current
//      database schema physically permits (backlog: "cross-tenant FK
//      consistency is not fully prevented by the database") is checked
//      explicitly here. Any hit fails the ENTIRE load; a plan pointing at
//      another tenant's data is never partially accepted, and tenant
//      mismatches are never downgraded to membership exclusions.
//
//   2. validateStructure — incomplete or contradictory configuration is
//      rejected wholesale ("no partial configuration acceptance"). There
//      is deliberately no fallback to V1 values anywhere: a missing piece
//      of V2 configuration is an error, never a silent default.
//
// Issue subjectIds are record ids (or enum names) only — never pharmacy,
// organization, or plan content.

import { parseCarriedForward } from "./rotation-state";
import { BUILTIN_DAY_TYPES } from "./domain/loaded-plan";
import type { LoaderIssue } from "./errors";
import {
  toIsoDate,
  type PlanVersionRecord,
  type RotationPoolRecord,
} from "./plan-version-record";

export type TenantContext = {
  organizationId: string;
  regionId: string;
};

export function validateTenantIntegrity(
  record: PlanVersionRecord,
  context: TenantContext
): LoaderIssue[] {
  const issues: LoaderIssue[] = [];

  // Checks 1–2 (plan.organizationId / plan.regionId match the request)
  // are enforced by the repository's root-scoped query — a mismatch can
  // only mean the repository was bypassed, so they are re-asserted here
  // defensively at zero cost.
  if (record.plan.organizationId !== context.organizationId) {
    issues.push({ code: "PLAN_REGION_ORGANIZATION_MISMATCH", subjectId: record.plan.id });
  }
  if (record.plan.regionId !== context.regionId) {
    issues.push({ code: "PLAN_REGION_ORGANIZATION_MISMATCH", subjectId: record.plan.id });
  }
  // Check 3: the plan's region must belong to the plan's organization
  // (DutyPlan carries BOTH organizationId and regionId; the schema does
  // not force them consistent).
  if (record.plan.region.organizationId !== record.plan.organizationId) {
    issues.push({ code: "PLAN_REGION_ORGANIZATION_MISMATCH", subjectId: record.plan.id });
  }

  for (const pool of record.rotationPools) {
    // Check 4: slot → pool may cross organizations at the DB level.
    if (pool.organizationId !== record.plan.organizationId) {
      issues.push({ code: "POOL_ORGANIZATION_MISMATCH", subjectId: pool.id });
    }
    // Check 5: a region-scoped pool must be scoped to the PLAN's region;
    // regionId null = organization-wide pool, valid by design.
    if (pool.regionId !== null && pool.regionId !== record.plan.regionId) {
      issues.push({ code: "POOL_REGION_MISMATCH", subjectId: pool.id });
    }
    for (const membership of pool.memberships) {
      // Check 6: membership → pharmacy may cross organizations at the DB
      // level (pharmacy ownership derives through its region).
      if (membership.pharmacy.regionOrganizationId !== record.plan.organizationId) {
        issues.push({
          code: "MEMBERSHIP_PHARMACY_ORGANIZATION_MISMATCH",
          subjectId: membership.id,
        });
        continue; // The region check below would be meaningless noise.
      }
      // Check 7: when the pool itself is region-scoped, every member
      // pharmacy must belong to that region. Organization-wide pools
      // (regionId null) intentionally allow same-organization pharmacies
      // from any region — that is what "shareable across regions" means.
      if (pool.regionId !== null && membership.pharmacy.regionId !== pool.regionId) {
        issues.push({ code: "MEMBERSHIP_PHARMACY_REGION_MISMATCH", subjectId: membership.id });
      }
    }
  }

  return issues;
}

// ---------------------------------------------------------------------------
// Reusable tenant validators for FUTURE schedule/assignment integration
// (Phase 4+ consumes these; nothing calls them in production yet). They
// exist so the ownership rule is defined once, here, instead of being
// re-derived when DutySchedule.planVersionId / DutyAssignment.
// shiftDefinitionId links are first written.
// ---------------------------------------------------------------------------

/** A DutySchedule linked to a plan version is tenant-consistent iff its
 *  region is the plan's region within the plan's organization. */
export function validateLinkedScheduleTenantConsistency(input: {
  scheduleId: string;
  scheduleRegionId: string;
  scheduleRegionOrganizationId: string;
  planRegionId: string;
  planOrganizationId: string;
}): LoaderIssue[] {
  const issues: LoaderIssue[] = [];
  if (
    input.scheduleRegionOrganizationId !== input.planOrganizationId ||
    input.scheduleRegionId !== input.planRegionId
  ) {
    issues.push({ code: "PLAN_REGION_ORGANIZATION_MISMATCH", subjectId: input.scheduleId });
  }
  return issues;
}

/** A DutyAssignment linked to a shift is tenant-consistent iff its
 *  pharmacy belongs to the organization owning the shift's plan. */
export function validateLinkedAssignmentTenantConsistency(input: {
  assignmentId: string;
  pharmacyRegionOrganizationId: string;
  shiftPlanOrganizationId: string;
}): LoaderIssue[] {
  const issues: LoaderIssue[] = [];
  if (input.pharmacyRegionOrganizationId !== input.shiftPlanOrganizationId) {
    issues.push({
      code: "MEMBERSHIP_PHARMACY_ORGANIZATION_MISMATCH",
      subjectId: input.assignmentId,
    });
  }
  return issues;
}

// ---------------------------------------------------------------------------
// Structural validation.
// ---------------------------------------------------------------------------

const BUILTIN_DAY_TYPE_SET: ReadonlySet<string> = new Set(BUILTIN_DAY_TYPES);

export function validateStructure(record: PlanVersionRecord): LoaderIssue[] {
  const issues: LoaderIssue[] = [];

  // Validity period: start must not be after end (compared as calendar
  // days, matching every other date semantic in the loader).
  if (record.validTo !== null && toIsoDate(record.validFrom) > toIsoDate(record.validTo)) {
    issues.push({ code: "INVALID_VALIDITY_PERIOD", subjectId: record.id });
  }

  // Day types. A loadable version must define ALL SIX built-in day types
  // explicitly (isServed may be false — that IS an explicit decision).
  // This is the "no hidden defaults" rule in action: the engine must
  // never have to guess what happens on, say, a religious holiday.
  const builtinSeen = new Map<string, string>(); // dayType -> first rule id
  const customSeen = new Set<string>(); // dayType|category
  for (const rule of record.dayTypeRules) {
    if (rule.customDayCategory === null) {
      if (builtinSeen.has(rule.dayType)) {
        issues.push({ code: "DUPLICATE_DAY_TYPE", subjectId: rule.id });
      } else {
        builtinSeen.set(rule.dayType, rule.id);
      }
    } else {
      if (rule.customDayCategory.trim().length === 0) {
        issues.push({ code: "AMBIGUOUS_CUSTOM_DAY_CATEGORY", subjectId: rule.id });
        continue;
      }
      const key = `${rule.dayType}|${rule.customDayCategory}`;
      if (customSeen.has(key)) {
        issues.push({ code: "AMBIGUOUS_CUSTOM_DAY_CATEGORY", subjectId: rule.id });
      }
      customSeen.add(key);
    }
  }
  for (const required of BUILTIN_DAY_TYPES) {
    if (!builtinSeen.has(required)) {
      issues.push({ code: "MISSING_DAY_TYPE", subjectId: required });
    }
  }
  // A persisted dayType outside the known enum cannot happen through
  // Prisma, but records are also built in unit tests — reject unknowns
  // as duplicates of nothing rather than silently passing them through.
  for (const rule of record.dayTypeRules) {
    if (!BUILTIN_DAY_TYPE_SET.has(rule.dayType)) {
      issues.push({ code: "DUPLICATE_DAY_TYPE", subjectId: rule.id });
    }
  }

  // Shifts: names are the human-stable keys (DB-unique per version;
  // re-asserted because records can be constructed in tests/tools).
  const shiftIds = new Set<string>();
  const shiftNames = new Set<string>();
  for (const shift of record.shiftDefinitions) {
    if (shiftIds.has(shift.id) || shiftNames.has(shift.name)) {
      issues.push({ code: "DUPLICATE_SHIFT_NAME", subjectId: shift.id });
    }
    shiftIds.add(shift.id);
    shiftNames.add(shift.name);
  }

  // Pools: unique ids and names within the loaded context.
  const poolIds = new Set<string>();
  const poolNames = new Set<string>();
  for (const pool of record.rotationPools) {
    if (poolIds.has(pool.id) || poolNames.has(pool.name)) {
      issues.push({ code: "DUPLICATE_POOL_NAME", subjectId: pool.id });
    }
    poolIds.add(pool.id);
    poolNames.add(pool.name);
  }

  // Slots: every reference must land inside the loaded graph — a slot
  // pointing at a shift from ANOTHER version (the schema permits it) or
  // at a pool the query did not resolve is contradictory configuration.
  const slotKeys = new Set<string>();
  for (const rule of record.dayTypeRules) {
    for (const slot of rule.slotRequirements) {
      if (slot.requiredCount < 1) {
        issues.push({ code: "INVALID_REQUIRED_COUNT", subjectId: slot.id });
      }
      if (!shiftIds.has(slot.shiftDefinitionId)) {
        issues.push({ code: "UNKNOWN_SHIFT_REFERENCE", subjectId: slot.id });
      }
      if (slot.rotationPoolId !== null && !poolIds.has(slot.rotationPoolId)) {
        issues.push({ code: "UNKNOWN_POOL_REFERENCE", subjectId: slot.id });
      }
      const naturalKey = `${slot.dayTypeRuleId}|${slot.shiftDefinitionId}|${slot.sortOrder}`;
      if (slotKeys.has(naturalKey)) {
        issues.push({ code: "DUPLICATE_SLOT", subjectId: slot.id });
      }
      slotKeys.add(naturalKey);
    }
  }

  // Memberships and rotation state, per pool.
  for (const pool of record.rotationPools) {
    issues.push(...validatePoolInternals(pool));
  }

  return issues;
}

function validatePoolInternals(pool: RotationPoolRecord): LoaderIssue[] {
  const issues: LoaderIssue[] = [];

  const membershipIds = new Set<string>();
  const periodsByPharmacy = new Map<string, { joined: string; left: string | null; id: string }[]>();
  for (const membership of pool.memberships) {
    if (membershipIds.has(membership.id)) {
      issues.push({ code: "DUPLICATE_MEMBERSHIP", subjectId: membership.id });
    }
    membershipIds.add(membership.id);

    const joined = toIsoDate(membership.joinedAt);
    const left = membership.leftAt === null ? null : toIsoDate(membership.leftAt);
    // [joinedOn, leftOn) — an end on or before the start is an empty or
    // negative period, which the lifecycle never produces.
    if (left !== null && left <= joined) {
      issues.push({ code: "INVALID_MEMBERSHIP_PERIOD", subjectId: membership.id });
      continue;
    }
    const periods = periodsByPharmacy.get(membership.pharmacyId) ?? [];
    periods.push({ joined, left, id: membership.id });
    periodsByPharmacy.set(membership.pharmacyId, periods);
  }

  // Overlap detection per (pool, pharmacy) using [joinedOn, leftOn):
  // after sorting by joinedOn, a row overlaps its predecessor when the
  // predecessor is still open (left null) or ends after this row starts.
  for (const periods of periodsByPharmacy.values()) {
    periods.sort((a, b) => (a.joined < b.joined ? -1 : a.joined > b.joined ? 1 : 0));
    for (let i = 1; i < periods.length; i++) {
      const previous = periods[i - 1];
      const current = periods[i];
      if (previous.left === null || current.joined < previous.left) {
        issues.push({ code: "OVERLAPPING_MEMBERSHIP", subjectId: current.id });
      }
    }
  }

  const scopesSeen = new Set<string>();
  for (const state of pool.rotationStates) {
    if (scopesSeen.has(state.dayTypeScope)) {
      issues.push({ code: "INVALID_ROTATION_STATE", subjectId: state.id });
    }
    scopesSeen.add(state.dayTypeScope);

    if (
      !Number.isInteger(state.lockVersion) ||
      state.lockVersion < 0 ||
      !Number.isInteger(state.currentRound) ||
      state.currentRound < 0
    ) {
      issues.push({ code: "INVALID_ROTATION_STATE", subjectId: state.id });
    }
    // The cursor must point INTO this pool's membership history.
    if (
      state.lastServedMembershipId !== null &&
      !membershipIds.has(state.lastServedMembershipId)
    ) {
      issues.push({ code: "INVALID_ROTATION_STATE", subjectId: state.id });
    }
    try {
      const carried = parseCarriedForward(state.carriedForward);
      for (const entry of carried) {
        if (!membershipIds.has(entry.membershipId)) {
          issues.push({ code: "INVALID_CARRIED_FORWARD", subjectId: state.id });
          break;
        }
      }
    } catch {
      issues.push({ code: "INVALID_CARRIED_FORWARD", subjectId: state.id });
    }
  }

  return issues;
}
