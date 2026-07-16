// Duty Rules V2 engine — Stage 7b: eligibility evaluation.
//
// Maps constraint results into an explainable eligibility verdict per
// candidate. The minimum-day interval is NOT relaxed here — a failure is
// represented as a reason, and the LIMITED relaxation belongs to the
// dedicated policy stage (apply-eligibility-relaxation.ts), exactly
// mirroring V1's structure. PREFER_DUTY is deliberately NOT an
// eligibility fact: it is a fairness preference (Stage 9).

import type { EligibilityReasonCode } from "./domain/diagnostics";
import type { ConstraintResult } from "./domain/constraint";
import type { SlotCandidate } from "./resolve-candidates";

export type CandidateEligibilityResult = {
  candidateKey: string;
  slotKey: string;
  date: string;
  pharmacyId: string;
  eligible: boolean;
  /** Failed HARD constraints as stable reasons, sorted. */
  hardExclusionReasons: EligibilityReasonCode[];
  /** Failed SOFT constraints (none exist yet in compatibility mode). */
  softConcerns: string[];
  /** The facts the verdict used — auditability, never re-derived. */
  factsUsed: {
    membershipExclusion: SlotCandidate["membershipExclusion"];
    unavailableOnDate: boolean;
    blockingRequestType: SlotCandidate["blockingRequestType"];
    daysSinceLastDuty: number | null;
    assignedToThisSlot: boolean;
    assignedSameDayElsewhere: boolean;
  };
  constraintResults: ConstraintResult[];
};

export function evaluateEligibility(
  candidate: SlotCandidate,
  constraintResults: ConstraintResult[]
): CandidateEligibilityResult {
  const hardExclusionReasons = constraintResults
    .filter((result) => result.severity === "HARD" && !result.passed)
    .map((result) => result.explanationCode as EligibilityReasonCode)
    .sort();

  return {
    candidateKey: candidate.candidateKey,
    slotKey: candidate.slotKey,
    date: candidate.date,
    pharmacyId: candidate.pharmacyId,
    eligible: hardExclusionReasons.length === 0,
    hardExclusionReasons,
    softConcerns: constraintResults
      .filter((result) => result.severity === "SOFT" && !result.passed)
      .map((result) => result.explanationCode)
      .sort(),
    factsUsed: {
      membershipExclusion: candidate.membershipExclusion,
      unavailableOnDate: candidate.unavailableOnDate,
      blockingRequestType: candidate.blockingRequestType,
      daysSinceLastDuty: candidate.daysSinceLastDuty,
      assignedToThisSlot: candidate.assignedToThisSlot,
      assignedSameDayElsewhere: candidate.assignedSameDayElsewhere,
    },
    constraintResults,
  };
}
