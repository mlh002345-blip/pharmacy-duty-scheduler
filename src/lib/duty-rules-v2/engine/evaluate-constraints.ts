// Duty Rules V2 engine — Stage 7a: constraint evaluation.
//
// The single source of hard-fact evaluation: the eligibility evaluator
// derives its verdicts from these results rather than re-deriving them,
// so no rule exists twice. Every constraint is HARD in V1 compatibility;
// DAILY_ASSIGNMENT_LIMIT applies only when the explicit input policy
// disallows same-day second assignments.

import type { EngineSchedulingPolicy } from "./domain/engine-input";
import type { ConstraintResult } from "./domain/constraint";
import { sortConstraintResults } from "./domain/constraint";
import type { SlotCandidate } from "./resolve-candidates";

export function evaluateConstraints(
  candidate: SlotCandidate,
  policy: EngineSchedulingPolicy
): ConstraintResult[] {
  const base = {
    candidateKey: candidate.candidateKey,
    date: candidate.date,
    slotKey: candidate.slotKey,
    severity: "HARD" as const,
  };
  const results: ConstraintResult[] = [];

  results.push({
    ...base,
    constraintCode: "PHARMACY_ACTIVE",
    passed: candidate.membershipExclusion !== "PHARMACY_INACTIVE",
    observedValue: candidate.pharmacyIsActive ? "active" : "inactive",
    expectedValue: "active",
    explanationCode: "PHARMACY_INACTIVE",
  });

  results.push({
    ...base,
    constraintCode: "MEMBER_AS_OF_DATE",
    passed: candidate.membershipExclusion !== "NOT_A_MEMBER",
    observedValue: candidate.membershipExclusion === "NOT_A_MEMBER" ? "not-member" : "member",
    expectedValue: "member",
    explanationCode: "NOT_A_MEMBER",
  });

  results.push({
    ...base,
    constraintCode: "NOT_UNAVAILABLE",
    passed: !candidate.unavailableOnDate,
    observedValue: candidate.unavailableOnDate ? "unavailable" : "available",
    expectedValue: "available",
    explanationCode: "UNAVAILABLE",
  });

  results.push({
    ...base,
    constraintCode: "NO_BLOCKING_DUTY_REQUEST",
    passed: candidate.blockingRequestType === null,
    observedValue: candidate.blockingRequestType ?? "none",
    expectedValue: "none",
    explanationCode:
      candidate.blockingRequestType === "EMERGENCY_EXCUSE"
        ? "EMERGENCY_EXCUSE"
        : "CANNOT_DUTY_REQUEST",
  });

  // V1 semantics (generate-duty-schedule.ts:260-264): a pharmacy with no
  // prior duty passes unconditionally; otherwise the gap must be >= the
  // configured minimum.
  const intervalPassed =
    candidate.daysSinceLastDuty === null ||
    candidate.daysSinceLastDuty >= policy.minDaysBetweenDuties;
  results.push({
    ...base,
    constraintCode: "MIN_DAYS_BETWEEN_DUTIES",
    passed: intervalPassed,
    observedValue: candidate.daysSinceLastDuty === null ? "never" : String(candidate.daysSinceLastDuty),
    expectedValue: `>=${policy.minDaysBetweenDuties}`,
    explanationCode: "MIN_DAYS_INTERVAL",
  });

  results.push({
    ...base,
    constraintCode: "SAME_SLOT_DUPLICATE",
    passed: !candidate.assignedToThisSlot,
    observedValue: candidate.assignedToThisSlot ? "assigned" : "unassigned",
    expectedValue: "unassigned",
    explanationCode: "DUPLICATE_SLOT_ASSIGNMENT",
  });

  if (!policy.sameDaySecondAssignmentAllowed) {
    results.push({
      ...base,
      constraintCode: "DAILY_ASSIGNMENT_LIMIT",
      passed: !candidate.assignedSameDayElsewhere,
      observedValue: candidate.assignedSameDayElsewhere ? "same-day-assigned" : "free",
      expectedValue: "free",
      explanationCode: "SAME_DAY_ASSIGNMENT_CONFLICT",
    });
  }

  return sortConstraintResults(results);
}
