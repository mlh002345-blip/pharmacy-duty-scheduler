// Duty Rules V2 engine — Stage 8: fairness facts calculator.
//
// Immutable, per-candidate fairness FACTS — no winner selection, no
// running-state mutation. Field provenance:
//
//   historicalWeightedLoad   persisted history (EngineHistoricalDuty)
//   historicalDutyCount      persisted history
//   weekendCount             persisted history + period assignments
//   sundayCount              persisted history + period assignments
//   holidayCount             period assignments on holiday dates +
//                            historical dates matching runtime holidays
//   balanceAdjustment        DutyBalanceAdjustment totals (runtime input)
//   currentPeriodWeightedLoad  existing assignments inside the period
//   totalWeightedLoad        history + balance + period (V1's
//                            totalLoadScore seeding, generate-duty-
//                            schedule.ts:184-236, expressed as facts)
//   projectedLoadIfAssigned  totalWeightedLoad + this date's weight
//   dateWeight               plan configuration: policy day-type weight ×
//                            shift defaultWeight
//   prefersThisDate          approved PREFER_DUTY request (preference,
//                            never eligibility)
//   nameTieBreakValue        V1 compatibility: the pharmacy name used by
//                            localeCompare(name, "tr") as the final tie-break
//
// The interval facts (lastDutyDate, daysSinceLastDuty) repeat the
// candidate's values so SelectionInput is self-contained.

import { DutyEngineError, type EngineSchedulingPolicy } from "./domain/engine-input";
import type { SlotCandidate } from "./resolve-candidates";
import type { ResolvedShift } from "./resolve-shifts";

export type CandidateFairnessFacts = {
  candidateKey: string;
  pharmacyId: string;
  dateWeight: number;
  historicalDutyCount: number;
  historicalWeightedLoad: number;
  balanceAdjustment: number;
  currentPeriodWeightedLoad: number;
  totalWeightedLoad: number;
  projectedLoadIfAssigned: number;
  totalAssignmentCount: number;
  weekendCount: number;
  sundayCount: number;
  holidayCount: number;
  lastDutyDate: string | null;
  daysSinceLastDuty: number | null;
  prefersThisDate: boolean;
  nameTieBreakValue: string;
};

export function resolveDateWeight(
  dayTypeKey: string,
  shift: Pick<ResolvedShift, "defaultWeight">,
  policy: EngineSchedulingPolicy
): number {
  const entry = policy.dayTypeWeights.find((weight) => weight.dayTypeKey === dayTypeKey);
  if (!entry) {
    // No hidden defaults: a served day type without an explicit weight is
    // a caller error, never silently weighted 1.
    throw new DutyEngineError(
      "UNKNOWN_DAY_TYPE_WEIGHT",
      `Gün türü için ağırlık tanımsız: ${dayTypeKey}`
    );
  }
  return entry.weight * shift.defaultWeight;
}

export function calculateFairnessFacts(input: {
  candidate: SlotCandidate;
  dayTypeKey: string;
  shift: Pick<ResolvedShift, "defaultWeight">;
  policy: EngineSchedulingPolicy;
  /** All runtime holiday dates (for weekend/holiday counting). */
  holidayDates: ReadonlySet<string>;
}): CandidateFairnessFacts {
  const { candidate, policy, holidayDates } = input;
  const dateWeight = resolveDateWeight(input.dayTypeKey, input.shift, policy);

  const periodLoad = candidate.periodAssignments.reduce((sum, a) => sum + a.weight, 0);
  const totalWeightedLoad =
    candidate.historicalWeightedLoad + candidate.balanceAdjustment + periodLoad;

  const isWeekend = (date: string) => {
    const day = new Date(`${date}T00:00:00.000Z`).getUTCDay();
    return day === 0 || day === 6;
  };
  const isSunday = (date: string) => new Date(`${date}T00:00:00.000Z`).getUTCDay() === 0;

  // V1 seeds weekend counts from history but starts holiday counts at
  // zero (generate-duty-schedule.ts:227-236 never touches holidayDuties),
  // and tracks no separate Sunday counter. Mirrored exactly: weekend =
  // history aggregate + period; Sunday/holiday = period only.
  const periodDates = candidate.periodAssignments.map((a) => a.date);

  return {
    candidateKey: candidate.candidateKey,
    pharmacyId: candidate.pharmacyId,
    dateWeight,
    historicalDutyCount: candidate.historicalDutyCount,
    historicalWeightedLoad: candidate.historicalWeightedLoad,
    balanceAdjustment: candidate.balanceAdjustment,
    currentPeriodWeightedLoad: periodLoad,
    totalWeightedLoad,
    projectedLoadIfAssigned: totalWeightedLoad + dateWeight,
    totalAssignmentCount: candidate.historicalDutyCount + candidate.periodAssignments.length,
    weekendCount:
      candidate.historicalWeekendCount + periodDates.filter((date) => isWeekend(date)).length,
    sundayCount: periodDates.filter((date) => isSunday(date)).length,
    holidayCount: periodDates.filter((date) => holidayDates.has(date)).length,
    lastDutyDate: candidate.lastDutyDate,
    daysSinceLastDuty: candidate.daysSinceLastDuty,
    prefersThisDate: candidate.prefersThisDate,
    nameTieBreakValue: candidate.pharmacyName,
  };
}
