// Duty Rules V2 engine — the generic constraint contract.
//
// A constraint observes candidate facts and reports a structured,
// explainable result. Severities:
//   HARD     — failure excludes the candidate (subject only to the
//              explicitly limited relaxation policy)
//   SOFT     — failure is a ranking concern for the future selector
//   ADVISORY — informational; never affects selection
//
// Only the V1-compatibility constraints exist in this phase; no
// chamber-specific, geographic, or bespoke tradition rules.

export type ConstraintSeverity = "HARD" | "SOFT" | "ADVISORY";

export const CONSTRAINT_CODES = [
  "PHARMACY_ACTIVE",
  "MEMBER_AS_OF_DATE",
  "NOT_UNAVAILABLE",
  "NO_BLOCKING_DUTY_REQUEST",
  "MIN_DAYS_BETWEEN_DUTIES",
  "SAME_SLOT_DUPLICATE",
  "DAILY_ASSIGNMENT_LIMIT",
] as const;
export type ConstraintCode = (typeof CONSTRAINT_CODES)[number];

export type ConstraintResult = {
  constraintCode: ConstraintCode;
  severity: ConstraintSeverity;
  candidateKey: string;
  date: string;
  slotKey: string;
  passed: boolean;
  /** What was observed, as a stable string (e.g. "3", "EMERGENCY_EXCUSE",
   *  "none") — never tenant content. */
  observedValue: string;
  /** What the constraint expected, as a stable string (e.g. ">=5"). */
  expectedValue: string;
  /** Stable machine explanation code (usually an eligibility reason). */
  explanationCode: string;
};

/** Canonical ordering: candidateKey, then constraintCode. */
export function sortConstraintResults(results: ConstraintResult[]): ConstraintResult[] {
  return [...results].sort((a, b) => {
    if (a.candidateKey !== b.candidateKey) return a.candidateKey < b.candidateKey ? -1 : 1;
    return a.constraintCode < b.constraintCode ? -1 : a.constraintCode > b.constraintCode ? 1 : 0;
  });
}
