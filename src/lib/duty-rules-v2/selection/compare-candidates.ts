// Duty Rules V2 — Phase 6: the single platform-owned criterion
// comparator registry. Every ranking criterion — whether a strategy's
// own primary sequence or a chamber-configured tie-breaker — resolves
// through this ONE module. No chamber input ever supplies a comparator;
// only a criterion CODE, matched here.
//
// Convention: compare(a, b) < 0 means a ranks BEFORE b (a wins). Every
// function is a pure, total, deterministic order over its declared
// domain; documented null-ordering below. Only PHARMACY_NAME_TR_ASC uses
// locale comparison — everything else is numeric or code-point string
// comparison, matching Phase 3/4's established convention.

import type { CandidateRankingFacts, RankingCriterion } from "./domain/ranking-fact";

function compareNumberAsc(a: number, b: number): number {
  return a - b;
}

function compareCodePoint(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** null-first: an unset value ranks BEST (matches V1's "never served
 *  ranks first" and the fairness intuition "no data = most overdue"). */
function compareNullFirstThenAsc(a: number | string | null, b: number | string | null): number {
  if (a === b) return 0;
  if (a === null) return -1;
  if (b === null) return 1;
  return a < b ? -1 : 1;
}

/** null-last: an unset value ranks WORST (matches Phase 3/4's
 *  "sortIndex asc, nulls last" convention for structural positions). */
function compareNullLastThenAsc(a: number | null, b: number | null): number {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return a - b;
}

export function compareByCriterion(
  criterion: RankingCriterion,
  a: CandidateRankingFacts,
  b: CandidateRankingFacts
): number {
  switch (criterion) {
    case "PREFER_REQUESTED_DATE_DESC":
      if (a.prefersThisDate === b.prefersThisDate) return 0;
      return a.prefersThisDate ? -1 : 1;
    case "TOTAL_WEIGHTED_LOAD_ASC":
      return compareNumberAsc(a.totalWeightedLoad, b.totalWeightedLoad);
    case "PROJECTED_LOAD_ASC":
      return compareNumberAsc(a.projectedLoadIfAssigned, b.projectedLoadIfAssigned);
    case "TOTAL_ASSIGNMENT_COUNT_ASC":
      return compareNumberAsc(a.totalAssignmentCount, b.totalAssignmentCount);
    case "WEEKEND_COUNT_ASC":
      return compareNumberAsc(a.weekendCount, b.weekendCount);
    case "SUNDAY_COUNT_ASC":
      return compareNumberAsc(a.sundayCount, b.sundayCount);
    case "HOLIDAY_COUNT_ASC":
      return compareNumberAsc(a.holidayCount, b.holidayCount);
    case "LAST_DUTY_DATE_ASC":
      // Never-served (null) ranks first — identical to V1's
      // `if (!lastDutyDate) return -1`.
      return compareNullFirstThenAsc(a.lastDutyDate, b.lastDutyDate);
    case "DAYS_SINCE_LAST_DUTY_DESC": {
      // Never-served ranks first too (treated as "longest possible
      // wait"); otherwise more days-since ranks first (descending).
      if (a.daysSinceLastDuty === b.daysSinceLastDuty) return 0;
      if (a.daysSinceLastDuty === null) return -1;
      if (b.daysSinceLastDuty === null) return 1;
      return b.daysSinceLastDuty - a.daysSinceLastDuty;
    }
    case "ROTATION_DISTANCE_ASC":
      return compareNullLastThenAsc(a.distanceFromCursor, b.distanceFromCursor);
    case "CARRIED_FORWARD_PRIORITY_DESC":
      return b.carriedForwardCount - a.carriedForwardCount;
    case "CURRENT_ROUND_ASC":
      return compareNullLastThenAsc(a.currentRound, b.currentRound);
    case "MEMBERSHIP_SORT_INDEX_ASC":
      return compareNullLastThenAsc(a.sortIndex, b.sortIndex);
    case "MANUAL_ORDER_ASC":
      return compareNullLastThenAsc(a.manualOrderPosition, b.manualOrderPosition);
    case "SOFT_PENALTY_SCORE_ASC":
      return compareNumberAsc(a.softPenaltyScore, b.softPenaltyScore);
    case "WEIGHTED_SCORE_ASC":
      return compareNumberAsc(a.weightedScore, b.weightedScore);
    case "PHARMACY_NAME_TR_ASC":
      return a.pharmacyName.localeCompare(b.pharmacyName, "tr");
    case "PHARMACY_ID_ASC":
      return compareCodePoint(a.pharmacyId, b.pharmacyId);
    case "CANDIDATE_KEY_ASC":
      return compareCodePoint(a.candidateKey, b.candidateKey);
  }
}

/** Human/audit-stable string of the observed value for a criterion —
 *  used only in the comparator trace, never as logic. */
export function observedValueFor(criterion: RankingCriterion, c: CandidateRankingFacts): string {
  switch (criterion) {
    case "PREFER_REQUESTED_DATE_DESC":
      return String(c.prefersThisDate);
    case "TOTAL_WEIGHTED_LOAD_ASC":
      return String(c.totalWeightedLoad);
    case "PROJECTED_LOAD_ASC":
      return String(c.projectedLoadIfAssigned);
    case "TOTAL_ASSIGNMENT_COUNT_ASC":
      return String(c.totalAssignmentCount);
    case "WEEKEND_COUNT_ASC":
      return String(c.weekendCount);
    case "SUNDAY_COUNT_ASC":
      return String(c.sundayCount);
    case "HOLIDAY_COUNT_ASC":
      return String(c.holidayCount);
    case "LAST_DUTY_DATE_ASC":
      return c.lastDutyDate ?? "never";
    case "DAYS_SINCE_LAST_DUTY_DESC":
      return c.daysSinceLastDuty === null ? "never" : String(c.daysSinceLastDuty);
    case "ROTATION_DISTANCE_ASC":
      return c.distanceFromCursor === null ? "n/a" : String(c.distanceFromCursor);
    case "CARRIED_FORWARD_PRIORITY_DESC":
      return String(c.carriedForwardCount);
    case "CURRENT_ROUND_ASC":
      return c.currentRound === null ? "n/a" : String(c.currentRound);
    case "MEMBERSHIP_SORT_INDEX_ASC":
      return c.sortIndex === null ? "n/a" : String(c.sortIndex);
    case "MANUAL_ORDER_ASC":
      return c.manualOrderPosition === null ? "n/a" : String(c.manualOrderPosition);
    case "SOFT_PENALTY_SCORE_ASC":
      return String(c.softPenaltyScore);
    case "WEIGHTED_SCORE_ASC":
      return String(c.weightedScore);
    case "PHARMACY_NAME_TR_ASC":
      return c.pharmacyName;
    case "PHARMACY_ID_ASC":
      return c.pharmacyId;
    case "CANDIDATE_KEY_ASC":
      return c.candidateKey;
  }
}
