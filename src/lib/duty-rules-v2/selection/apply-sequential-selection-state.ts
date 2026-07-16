// Duty Rules V2 — Phase 6 corrective: minimum pure in-memory sequential
// selection state required for V1 equivalence.
//
// ROOT PROBLEM: V1 (generate-duty-schedule.ts:248-326) processes a
// period's dates in a single chronological loop and MUTATES its
// `metrics` map after each date's selection — so date N+1's ranking (and
// its MIN_DAYS_BETWEEN_DUTIES eligibility check) already reflects
// candidates selected on date N, N-1, etc., in the SAME run. Phase 6's
// original per-slot design selected every slot independently from
// Phase 4/5's pre-computed facts, which only include HISTORY and
// EXISTING (persisted) assignments — never assignments provisionally
// selected earlier in the same run. For any period longer than one
// date, this made the two paths diverge whenever an earlier date's
// winner changed a later date's fairness comparison or interval
// eligibility.
//
// FIX (deliberately minimal — NOT global optimization/backtracking):
// walk the already-Phase-4/5-resolved SelectionInputs in chronological
// order (their natural order — slotKey is date-prefixed), keeping a
// pure, in-memory accumulator of "what this run has provisionally
// assigned so far" per pharmacyId. Before ranking each date, fold the
// accumulator into that date's ranking facts (weight/count/last-duty)
// AND recompute which candidates are strictly interval-eligible under
// V1's exact policy (strict first, relax only when insufficient) using
// the accumulator's up-to-date lastDutyDate. After selecting, update the
// accumulator. No database access, no RotationState mutation — this is
// exactly the loop-local `metrics` map V1 already has, expressed as an
// explicit, typed, pure data structure instead of hidden mutable state.

import { diffInDays } from "../engine/domain/dates";
import type { SelectionInput } from "../engine/build-selection-input";
import { buildCandidateRankingFacts, buildStrategyMatchContext } from "./build-strategy-context";
import { selectProvisionalWinnersFromFacts } from "./select-provisional-winners";
import type { CandidateRankingFacts } from "./domain/ranking-fact";
import type { ConfiguredSelectionStrategy } from "./domain/strategy-definition";
import type { ProvisionalSlotSelection } from "./domain/selection-result";

export type SequentialAccumulatorEntry = {
  addedWeight: number;
  addedAssignmentCount: number;
  addedWeekendCount: number;
  addedHolidayCount: number;
  /** Most recent date (within this run) this pharmacy was provisionally
   *  selected on. Dates are processed in ascending order, so the latest
   *  write is always the most recent — no comparison needed at write
   *  time, only at read time against Phase 4's own lastDutyDate. */
  newestLastDutyDate: string | null;
};

export type SequentialAccumulator = ReadonlyMap<string, SequentialAccumulatorEntry>;

const EMPTY_ENTRY: SequentialAccumulatorEntry = {
  addedWeight: 0,
  addedAssignmentCount: 0,
  addedWeekendCount: 0,
  addedHolidayCount: 0,
  newestLastDutyDate: null,
};

/** Fold accumulated in-run selections into one date's ranking facts.
 *  Pure: returns NEW fact objects, never mutates its input. */
export function applyAccumulatorToFacts(
  facts: readonly CandidateRankingFacts[],
  accumulator: SequentialAccumulator,
  currentDate: string
): CandidateRankingFacts[] {
  return facts.map((fact) => {
    const acc = accumulator.get(fact.pharmacyId) ?? EMPTY_ENTRY;
    if (acc.addedAssignmentCount === 0) return fact; // nothing accumulated yet for this pharmacy

    const effectiveLastDutyDate =
      acc.newestLastDutyDate !== null &&
      (fact.lastDutyDate === null || acc.newestLastDutyDate > fact.lastDutyDate)
        ? acc.newestLastDutyDate
        : fact.lastDutyDate;

    const dateWeightForThisSlot = fact.projectedLoadIfAssigned - fact.totalWeightedLoad;
    const adjustedTotalWeightedLoad = fact.totalWeightedLoad + acc.addedWeight;

    return {
      ...fact,
      totalWeightedLoad: adjustedTotalWeightedLoad,
      projectedLoadIfAssigned: adjustedTotalWeightedLoad + dateWeightForThisSlot,
      totalAssignmentCount: fact.totalAssignmentCount + acc.addedAssignmentCount,
      weekendCount: fact.weekendCount + acc.addedWeekendCount,
      holidayCount: fact.holidayCount + acc.addedHolidayCount,
      lastDutyDate: effectiveLastDutyDate,
      daysSinceLastDuty:
        effectiveLastDutyDate === null ? null : diffInDays(currentDate, effectiveLastDutyDate),
    };
  });
}

/** Recompute strict/relaxed candidate-set membership using the
 *  accumulator's up-to-date lastDutyDate, exactly V1's policy (strict
 *  first; relax the interval only when strictly-eligible candidates
 *  can't fill requiredCount). Sourced from Phase 4's ALREADY-COMPUTED
 *  strictEligible ∪ relaxedEligible union — every non-interval HARD
 *  exclusion (inactive, unavailable, blocking request, configured HARD
 *  rule) is untouched, since those never depend on within-run
 *  sequencing. */
export function resolveSequentialCandidateSet(
  selectionInput: SelectionInput,
  accumulator: SequentialAccumulator,
  minDaysBetweenDuties: number
): Map<string, "STRICT" | "RELAXED"> {
  const date = selectionInput.slot.date;
  const available = [
    ...new Set([
      ...selectionInput.relaxation.strictEligible,
      ...selectionInput.relaxation.relaxedEligible,
    ]),
  ];
  const candidateByKey = new Map(selectionInput.candidates.map((c) => [c.candidateKey, c]));
  const fairnessByKey = new Map(selectionInput.fairnessFacts.map((f) => [f.candidateKey, f]));

  const strict: string[] = [];
  for (const candidateKey of available) {
    const candidate = candidateByKey.get(candidateKey);
    if (!candidate) continue; // defensive; cannot happen for a validated SelectionInput
    const acc = accumulator.get(candidate.pharmacyId) ?? EMPTY_ENTRY;
    const baseLastDutyDate = fairnessByKey.get(candidateKey)?.lastDutyDate ?? null;
    const effectiveLastDutyDate =
      acc.newestLastDutyDate !== null &&
      (baseLastDutyDate === null || acc.newestLastDutyDate > baseLastDutyDate)
        ? acc.newestLastDutyDate
        : baseLastDutyDate;
    if (effectiveLastDutyDate === null || diffInDays(date, effectiveLastDutyDate) >= minDaysBetweenDuties) {
      strict.push(candidateKey);
    }
  }

  const pool = strict.length >= selectionInput.requiredCount ? strict : available;
  const strictSet = new Set(strict);
  const origin = new Map<string, "STRICT" | "RELAXED">();
  for (const key of pool) {
    origin.set(key, strictSet.has(key) ? "STRICT" : "RELAXED");
  }
  return origin;
}

/** Fold one slot's provisional selection into the accumulator. Pure:
 *  returns a NEW accumulator map, never mutates its input. */
export function updateAccumulatorWithSelection(
  accumulator: SequentialAccumulator,
  selection: ProvisionalSlotSelection,
  facts: readonly CandidateRankingFacts[],
  isWeekendDate: boolean,
  isHolidayDate: boolean
): SequentialAccumulator {
  if (selection.selectedCandidateKeys.length === 0) return accumulator;
  const factByKey = new Map(facts.map((f) => [f.candidateKey, f]));
  const next = new Map(accumulator);
  for (const candidateKey of selection.selectedCandidateKeys) {
    const fact = factByKey.get(candidateKey);
    if (!fact) continue; // defensive
    const dateWeight = fact.projectedLoadIfAssigned - fact.totalWeightedLoad;
    const prior = next.get(fact.pharmacyId) ?? EMPTY_ENTRY;
    next.set(fact.pharmacyId, {
      addedWeight: prior.addedWeight + dateWeight,
      addedAssignmentCount: prior.addedAssignmentCount + 1,
      addedWeekendCount: prior.addedWeekendCount + (isWeekendDate ? 1 : 0),
      addedHolidayCount: prior.addedHolidayCount + (isHolidayDate ? 1 : 0),
      newestLastDutyDate: selection.date,
    });
  }
  return next;
}

/**
 * The period-level orchestrator: selects provisional winners for every
 * given slot, IN THE ORDER GIVEN (callers must pass slots in
 * chronological order — buildDutyEngineContext's calendar/slot loop
 * already iterates this way), carrying the sequential accumulator
 * forward. Pure, deterministic, no database access, no RotationState
 * mutation.
 */
export function selectProvisionalWinnersSequential(input: {
  slots: {
    selectionInput: SelectionInput;
    matchContextBase: Omit<Parameters<typeof buildStrategyMatchContext>[0], "selectionInput">;
    isWeekendDate: boolean;
    isHolidayDate: boolean;
  }[];
  minDaysBetweenDuties: number;
  definitions: ConfiguredSelectionStrategy[];
  definitionsById: ReadonlyMap<string, ConfiguredSelectionStrategy>;
}): ProvisionalSlotSelection[] {
  const results: ProvisionalSlotSelection[] = [];
  let accumulator: SequentialAccumulator = new Map();

  for (const { selectionInput, matchContextBase, isWeekendDate, isHolidayDate } of input.slots) {
    const origin = resolveSequentialCandidateSet(
      selectionInput,
      accumulator,
      input.minDaysBetweenDuties
    );
    const baseFacts = buildCandidateRankingFacts(selectionInput, origin);
    const adjustedFacts = applyAccumulatorToFacts(baseFacts, accumulator, selectionInput.slot.date);
    const matchContext = buildStrategyMatchContext({ ...matchContextBase, selectionInput });

    const result = selectProvisionalWinnersFromFacts({
      slotKey: selectionInput.slot.slotKey,
      date: selectionInput.slot.date,
      requiredCount: selectionInput.requiredCount,
      rankingFacts: adjustedFacts,
      matchContext,
      definitions: input.definitions,
      definitionsById: input.definitionsById,
    });
    results.push(result);

    accumulator = updateAccumulatorWithSelection(
      accumulator,
      result,
      adjustedFacts,
      isWeekendDate,
      isHolidayDate
    );
  }

  return results;
}
