// Duty Rules V2 — Phase 6: the controlled tie-breaker / ranking-criterion
// catalogue. Every code here is a PLATFORM-DEFINED deterministic
// comparator; chambers select and order codes, never define new ones.
//
// Comparator convention: `compare(a, b)` returns negative when `a`
// should sort BEFORE `b` (i.e. `a` ranks better / is selected first).
// Null ordering is explicit per criterion (documented inline). All
// structural identifiers (candidateKey, pharmacyId) use code-point
// comparison; ONLY PHARMACY_NAME_TR_ASC uses explicit Turkish locale
// comparison — no other criterion is locale-dependent.

export const RANKING_CRITERIA = [
  "PREFER_REQUESTED_DATE_DESC",
  "TOTAL_WEIGHTED_LOAD_ASC",
  "PROJECTED_LOAD_ASC",
  "TOTAL_ASSIGNMENT_COUNT_ASC",
  "WEEKEND_COUNT_ASC",
  "SUNDAY_COUNT_ASC",
  "HOLIDAY_COUNT_ASC",
  "LAST_DUTY_DATE_ASC",
  "DAYS_SINCE_LAST_DUTY_DESC",
  "ROTATION_DISTANCE_ASC",
  "CARRIED_FORWARD_PRIORITY_DESC",
  "CURRENT_ROUND_ASC",
  "MEMBERSHIP_SORT_INDEX_ASC",
  "MANUAL_ORDER_ASC",
  "SOFT_PENALTY_SCORE_ASC",
  "PHARMACY_NAME_TR_ASC",
  "PHARMACY_ID_ASC",
  "CANDIDATE_KEY_ASC",
  /** WEIGHTED_FAIRNESS only: the platform-computed bounded weighted
   *  score (lower = ranks first). Never chamber-selectable as a
   *  tie-breaker — it is the strategy's own primary criterion. */
  "WEIGHTED_SCORE_ASC",
] as const;
export type RankingCriterion = (typeof RANKING_CRITERIA)[number];

/** Tie-breaker codes are ranking criteria used specifically in a
 *  chamber-configured tie-break CHAIN (a subset excluding the two
 *  criteria that are never meaningful as an explicit tie-breaker
 *  choice: PREFER_REQUESTED_DATE_DESC and SOFT_PENALTY_SCORE_ASC,
 *  which strategies apply structurally, not as a tie-break pick). */
export const TIE_BREAKER_CODES = [
  "TOTAL_WEIGHTED_LOAD_ASC",
  "PROJECTED_LOAD_ASC",
  "TOTAL_ASSIGNMENT_COUNT_ASC",
  "WEEKEND_COUNT_ASC",
  "SUNDAY_COUNT_ASC",
  "HOLIDAY_COUNT_ASC",
  "LAST_DUTY_DATE_ASC",
  "DAYS_SINCE_LAST_DUTY_DESC",
  "ROTATION_DISTANCE_ASC",
  "MEMBERSHIP_SORT_INDEX_ASC",
  "MANUAL_ORDER_ASC",
  "PHARMACY_NAME_TR_ASC",
  "PHARMACY_ID_ASC",
] as const;
export type TieBreakerCode = (typeof TIE_BREAKER_CODES)[number];

/** The mandatory, non-configurable final fallback appended by the
 *  platform to EVERY comparator chain so no tie is ever left
 *  unresolved. */
export const FINAL_FALLBACK_CRITERION: RankingCriterion = "CANDIDATE_KEY_ASC";

/** Per-candidate ranking facts: a flat, comparator-ready projection of
 *  fairness/rotation/rule facts already computed by Phase 4/5. This
 *  module NEVER recomputes eligibility or rule outcomes — it only
 *  reshapes existing facts for ordering. */
export type CandidateRankingFacts = {
  candidateKey: string;
  pharmacyId: string;
  pharmacyName: string;
  origin: "STRICT" | "RELAXED";
  totalWeightedLoad: number;
  projectedLoadIfAssigned: number;
  totalAssignmentCount: number;
  weekendCount: number;
  sundayCount: number;
  holidayCount: number;
  lastDutyDate: string | null;
  daysSinceLastDuty: number | null;
  prefersThisDate: boolean;
  currentRound: number | null;
  distanceFromCursor: number | null;
  isCursor: boolean;
  carriedForwardCount: number;
  sortIndex: number | null;
  manualOrderPosition: number | null;
  /** Bounded, platform-computed SOFT-rule penalty facts (Phase 8). */
  softFailureCount: number;
  softPrioritySum: number;
  highestSoftPriority: number | null;
  /** Platform-default penalty (currently: softFailureCount). */
  softPenaltyScore: number;
  /** Count of SOFT failures per rule TYPE — the bounded, flat fact
   *  WEIGHTED_FAIRNESS's configured per-type weights multiply against.
   *  Never a callback, never unbounded (rule types are a closed
   *  platform catalogue). */
  softFailuresByRuleType: Readonly<Record<string, number>>;
  /** WEIGHTED_FAIRNESS only: computed by rank-candidates.ts from the
   *  chamber's bounded weights; 0 for every other strategy. */
  weightedScore: number;
};
