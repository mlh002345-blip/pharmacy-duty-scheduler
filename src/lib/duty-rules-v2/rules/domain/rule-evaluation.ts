// Duty Rules V2 — Phase 5: evaluation context and result contracts.
//
// RuleEvaluationContext is a PLAIN projection of Phase 4 facts — no
// Prisma types, no database handles, no current time. RuleEvaluation-
// Result is the generic typed outcome; user-facing prose never lives in
// the engine, only stable codes.

import type { SlotCandidate } from "../../engine/resolve-candidates";
import type { CandidateFairnessFacts } from "../../engine/calculate-fairness-facts";
import type { CandidateRotationFacts } from "../../engine/resolve-rotation-facts";
import type { ResolvedSlot } from "../../engine/resolve-slots";
import type { WeekdayName } from "../../engine/domain/dates";
import type { RuleGenerationMode, RuleHolidayType } from "./rule-scope";
import type { RuleSeverity } from "./rule-definition";

export type RuleEvaluationContext = {
  organizationId: string;
  regionId: string;
  planId: string;
  planVersionId: string;
  generationMode: RuleGenerationMode;
  periodStart: string;
  periodEnd: string;
  date: string;
  weekday: WeekdayName;
  /** Holiday types matching the date; ["NONE"] when none. */
  holidayTypes: RuleHolidayType[];
  /** All runtime holiday dates (for lookback rules). */
  holidayDates: ReadonlySet<string>;
  dayType: string;
  customDayCategory: string | null;
  dayTypeKey: string;
  slot: ResolvedSlot;
  poolId: string | null;
  shiftKey: string;
  /** Slot shift times, null for the synthetic whole-day V1 shift. */
  shiftStartMinute: number | null;
  shiftEndMinute: number | null;
  /** The candidate under evaluation; null for slot-level (quota) rules. */
  candidate: SlotCandidate | null;
  fairness: CandidateFairnessFacts | null;
  rotation: CandidateRotationFacts | null;
  /** Future facts — null until persistence/facts exist. Rules that need
   *  them return UNSUPPORTED_FACT, never a silent pass. */
  tags: null;
  groups: null;
  serviceAreas: null;
};

export const RULE_OUTCOMES = [
  "PASS",
  "FAIL",
  "NOT_APPLICABLE",
  "UNSUPPORTED_FACT",
  "INVALID_CONFIGURATION",
] as const;
export type RuleOutcome = (typeof RULE_OUTCOMES)[number];

export type RuleDecisionEffect =
  | "EXCLUDED"
  | "PENALIZED"
  | "INFORMATION_ONLY"
  | "NO_EFFECT"
  | "UNSUPPORTED";

export type RuleEvaluationResult = {
  ruleId: string;
  ruleType: string;
  ruleVersion: number;
  evaluatorVersion: number;
  severity: RuleSeverity;
  priority: number;
  applicable: boolean;
  outcome: RuleOutcome;
  /** false ONLY for outcome FAIL. */
  passed: boolean;
  candidateKey: string | null;
  date: string;
  slotKey: string;
  scopeMatch: boolean;
  effectivePeriodMatch: boolean;
  /** The exception kind that suppressed the rule, or null. */
  exceptionMatch: string | null;
  observedValue: string;
  expectedValue: string;
  violationCode: string | null;
  explanationCode: string;
  relaxable: boolean;
  decisionEffect: RuleDecisionEffect;
  /** Stable fact keys the evaluator read — auditability. */
  factsUsed: string[];
};

/** Canonical result ordering: slotKey, candidateKey (null first),
 *  priority, ruleType, ruleId. */
export function sortRuleResults(results: RuleEvaluationResult[]): RuleEvaluationResult[] {
  return [...results].sort((a, b) => {
    if (a.slotKey !== b.slotKey) return a.slotKey < b.slotKey ? -1 : 1;
    const ca = a.candidateKey ?? "";
    const cb = b.candidateKey ?? "";
    if (ca !== cb) return ca < cb ? -1 : 1;
    if (a.priority !== b.priority) return a.priority - b.priority;
    if (a.ruleType !== b.ruleType) return a.ruleType < b.ruleType ? -1 : 1;
    return a.ruleId < b.ruleId ? -1 : a.ruleId > b.ruleId ? 1 : 0;
  });
}
