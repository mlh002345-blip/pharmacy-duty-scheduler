// Duty Rules V2 — Phase 3: pure effective-date pool membership resolution.
//
// BOUNDARY SEMANTICS (deliberate, documented decision): the schema comment
// on RotationPoolMembership defines active membership as of date D as
//   joinedAt <= D AND (leftAt IS NULL OR leftAt > D)
// i.e. joinedOn is INCLUSIVE and leftOn is EXCLUSIVE. This matches the
// intended transfer lifecycle: a transfer on day D closes the old row with
// leftAt = D and opens the new row with joinedAt = D, so the pharmacy is a
// member of exactly one pool on D — no gap, no double membership.
//
// This function is PURE: it never touches the database, never mutates the
// pool, and never reads or advances RotationState. Tenant/region
// validation is NOT done here — the loader fails the entire load on any
// tenant mismatch before membership resolution runs (see
// validate-loaded-plan.ts), so TENANT_MISMATCH / REGION_MISMATCH are
// whole-load errors, never mere exclusion reasons.

import type {
  IsoDateString,
  LoadedRotationPool,
  ResolvedPoolMembershipSnapshot,
} from "./domain/loaded-plan";

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function isIsoDateString(value: string): boolean {
  if (!ISO_DATE_PATTERN.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

/**
 * Resolve which memberships of one pool are eligible as of a calendar
 * date. Ordering of the eligible list is deterministic:
 * sortIndex ascending with nulls LAST (MANUAL_ORDER pools define explicit
 * positions; unordered members follow), then pharmacyId by code point,
 * then membership id — never locale-dependent, so Turkish characters in
 * pharmacy names cannot affect it. Excluded memberships are returned with
 * stable reason codes, ordered by (membershipId).
 */
export function resolvePoolMembershipAsOf(
  pool: LoadedRotationPool,
  effectiveDate: IsoDateString
): ResolvedPoolMembershipSnapshot {
  if (!isIsoDateString(effectiveDate)) {
    throw new RangeError("effectiveDate must be a valid YYYY-MM-DD string");
  }

  const eligible: ResolvedPoolMembershipSnapshot["eligible"] = [];
  const excluded: ResolvedPoolMembershipSnapshot["excluded"] = [];

  for (const membership of pool.memberships) {
    if (membership.joinedOn > effectiveDate) {
      excluded.push({
        membershipId: membership.id,
        pharmacyId: membership.pharmacyId,
        reason: "NOT_YET_JOINED",
      });
      continue;
    }
    // leftOn is EXCLUSIVE: a membership with leftOn === effectiveDate has
    // already ended on that date.
    if (membership.leftOn !== null && membership.leftOn <= effectiveDate) {
      excluded.push({
        membershipId: membership.id,
        pharmacyId: membership.pharmacyId,
        reason: "LEFT_BEFORE_EFFECTIVE_DATE",
      });
      continue;
    }
    if (!membership.pharmacyIsActive) {
      excluded.push({
        membershipId: membership.id,
        pharmacyId: membership.pharmacyId,
        reason: "PHARMACY_INACTIVE",
      });
      continue;
    }
    eligible.push({
      membershipId: membership.id,
      pharmacyId: membership.pharmacyId,
      sortIndex: membership.sortIndex,
    });
  }

  eligible.sort((a, b) => {
    if (a.sortIndex !== b.sortIndex) {
      if (a.sortIndex === null) return 1;
      if (b.sortIndex === null) return -1;
      return a.sortIndex - b.sortIndex;
    }
    if (a.pharmacyId !== b.pharmacyId) return a.pharmacyId < b.pharmacyId ? -1 : 1;
    return a.membershipId < b.membershipId ? -1 : a.membershipId > b.membershipId ? 1 : 0;
  });
  excluded.sort((a, b) =>
    a.membershipId < b.membershipId ? -1 : a.membershipId > b.membershipId ? 1 : 0
  );

  return { poolId: pool.id, effectiveDate, eligible, excluded };
}
