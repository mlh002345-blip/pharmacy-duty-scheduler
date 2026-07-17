// Duty Rules V2 — Phase 6 corrective (round 2): minimum pure in-memory
// sequential selection state required for V1 equivalence, extended to
// close two blocking gaps found in independent review:
//
// B1 — SAME-DATE DOUBLE BOOKING: the original accumulator only folded
// weight/count/interval facts. It never re-derived same-day / same-slot
// HARD eligibility from THIS RUN's own earlier provisional picks —
// Phase 4's DAILY_ASSIGNMENT_LIMIT / SAME_SLOT_DUPLICATE constraints are
// computed once, before any provisional selection, from PERSISTED
// existingAssignments only (resolve-candidates.ts). With
// minDaysBetweenDuties=0 and multiple slots on one date, this let one
// pharmacy be provisionally selected twice on the same calendar date
// despite sameDaySecondAssignmentAllowed=false. FIXED below by tracking,
// per pharmacyId, whether it was already picked on the CURRENT date, and
// excluding it (hard, non-relaxable — matching Phase 4's own
// DAILY_ASSIGNMENT_LIMIT severity) from the candidate set before ranking
// any later same-date slot, when sameDaySecondAssignmentAllowed is
// false. A same-pharmacy, same-SLOT duplicate (via two distinct
// memberships) is a separate, non-sequential concern fixed in
// select-provisional-winners.ts (PROVISIONAL_SAME_SLOT_DUPLICATE).
//
// ROOT PROBLEM (unchanged from round 1): V1 (generate-duty-schedule.ts:
// 248-326) processes a period's dates in ONE chronological loop and
// MUTATES its `metrics` map after each date's selection, so date N+1's
// ranking (and its MIN_DAYS_BETWEEN_DUTIES eligibility check) already
// reflects candidates selected on date N, N-1, etc., in the SAME run.
//
// FIX (deliberately minimal — NOT global optimization/backtracking):
// walk SelectionInputs in chronological order, keeping a pure,
// immutable, per-pharmacyId accumulator. Before ranking each date, fold
// the accumulator into that date's ranking facts AND recompute
// strict/relaxed/hard-excluded membership under V1's exact interval
// policy plus the same-day policy. After selecting, update the
// accumulator. No database access, no RotationState mutation.
//
// CONFIGURED-RELAXABLE-RULE BOUNDARY (Part 8 of the corrective task —
// explicit, not silent): this module ONLY re-derives
// MIN_DAYS_BETWEEN_DUTIES (the V1 built-in interval) and the
// SAME_DAY_ASSIGNMENT_LIMIT policy against accumulated in-run state.
// Any OTHER chamber-configured relaxable HARD rule (Phase 5) is NOT
// re-evaluated against in-run provisional state — its relaxability
// still reflects only Phase 4/5's original, pre-run facts (history +
// persisted assignments), exactly as before this corrective. This is
// Option B from the corrective brief: explicitly restricted scope,
// never a silent claim of support that does not exist. A full
// RuleEvaluationContext-based re-run against in-run facts for arbitrary
// configured rules is out of scope here (would require re-invoking the
// Rule Engine per slot with synthesized "this-run" existingAssignments —
// a larger, separately-reviewable change).
//
// SEQUENTIAL-RELAXATION-CONTRACT CORRECTIVE (this round): closes a
// separate, previously-undetected gap found via the Phase 7 full-period
// V1 golden harness. Phase 4's applyEligibilityRelaxation only
// populates `relaxedEligible` when its OWN static, single-slot
// strictEligible count is already insufficient — it has no visibility
// into candidates this run's OWN sequential accumulator will later
// demote out of strict. When accumulator-adjusted strict count drops
// below requiredCount, this module now independently re-derives, from
// selectionInput.eligibility + selectionInput.relaxableReasonCodes
// (both already Phase 4/5 facts — NEVER re-evaluated), the FULL set of
// candidates whose hard failures are entirely relaxable, using the
// EXACT SAME predicate Phase 4 itself uses (`isRelaxAdmissible`,
// apply-eligibility-relaxation.ts) — never a duplicated or
// independently-invented rule. This is strictly a widening of the
// CANDIDATE UNIVERSE the sequential layer may draw from; it changes
// nothing about WHICH reasons are relaxable (still governed entirely by
// Phase 4/5's own relaxableReasonCodes) and never re-evaluates a
// configured HARD rule's condition — the Part 8 boundary above is
// otherwise unchanged.

import { diffInDays } from "../engine/domain/dates";
import { isRelaxAdmissible } from "../engine/apply-eligibility-relaxation";
import type { SelectionInput } from "../engine/build-selection-input";
import { buildCandidateRankingFacts, buildStrategyMatchContext } from "./build-strategy-context";
import { selectProvisionalWinnersFromFacts } from "./select-provisional-winners";
import { SelectionEngineError } from "./strategy-errors";
import type { CandidateRankingFacts } from "./domain/ranking-fact";
import type { ConfiguredSelectionStrategy } from "./domain/strategy-definition";
import type { ProvisionalSlotSelection } from "./domain/selection-result";

export type SequentialAccumulatorEntry = {
  addedWeight: number;
  addedAssignmentCount: number;
  addedWeekendCount: number;
  addedSundayCount: number;
  addedHolidayCount: number;
  /** Most recent date (within this run) this pharmacy was provisionally
   *  selected on. Dates are processed in ascending order, so the latest
   *  write is always the most recent — no comparison needed at write
   *  time, only at read time against Phase 4's own lastDutyDate. Also
   *  doubles as the SAME-DAY check: `newestLastDutyDate === date` means
   *  "already picked earlier THIS date, within this run." */
  newestLastDutyDate: string | null;
};

export type SequentialAccumulator = ReadonlyMap<string, SequentialAccumulatorEntry>;

const EMPTY_ENTRY: SequentialAccumulatorEntry = {
  addedWeight: 0,
  addedAssignmentCount: 0,
  addedWeekendCount: 0,
  addedSundayCount: 0,
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
      sundayCount: fact.sundayCount + acc.addedSundayCount,
      holidayCount: fact.holidayCount + acc.addedHolidayCount,
      lastDutyDate: effectiveLastDutyDate,
      daysSinceLastDuty:
        effectiveLastDutyDate === null ? null : diffInDays(currentDate, effectiveLastDutyDate),
    };
  });
}

export type SequentialCandidateSetResult = {
  origin: Map<string, "STRICT" | "RELAXED">;
  /** pharmacyIds hard-excluded from THIS slot specifically because they
   *  were already provisionally picked earlier THIS date, within this
   *  run (sameDaySecondAssignmentAllowed=false). Never relaxable —
   *  matches Phase 4's own DAILY_ASSIGNMENT_LIMIT severity. */
  sameDayExcludedPharmacyIds: string[];
  /** candidateKeys admitted ONLY because this module's sequential-
   *  relaxation widening fired (accumulator-adjusted strict count fell
   *  below requiredCount, and this candidate was independently found
   *  relax-admissible from Phase 4/5's own static eligibility facts,
   *  despite never appearing in Phase 4's static relaxedEligible).
   *  Empty when the widening never activates. Used only for the
   *  SEQUENTIAL_RELAXATION_APPLIED diagnostic — never changes ranking. */
  sequentiallyRelaxedCandidateKeys: string[];
};

/** Recompute strict/relaxed/hard-excluded candidate-set membership using
 *  the accumulator's up-to-date lastDutyDate and same-day state, exactly
 *  V1's policy (strict first; relax the interval only when strictly-
 *  eligible candidates can't fill requiredCount; same-day exclusion is
 *  NEVER relaxable). Starts from Phase 4's ALREADY-COMPUTED
 *  strictEligible ∪ relaxedEligible union — every non-interval,
 *  non-same-day HARD exclusion (inactive, unavailable, blocking request,
 *  configured HARD rule) is untouched, since those never depend on
 *  within-run sequencing — and WIDENS that union (see the
 *  SEQUENTIAL-RELAXATION-CONTRACT CORRECTIVE header comment above) only
 *  when accumulator-adjusted strict count is insufficient. */
export function resolveSequentialCandidateSet(
  selectionInput: SelectionInput,
  accumulator: SequentialAccumulator,
  minDaysBetweenDuties: number,
  sameDaySecondAssignmentAllowed: boolean,
  relaxMinIntervalWhenInsufficient: boolean
): SequentialCandidateSetResult {
  const date = selectionInput.slot.date;
  const available = [
    ...new Set([
      ...selectionInput.relaxation.strictEligible,
      ...selectionInput.relaxation.relaxedEligible,
    ]),
  ];
  const candidateByKey = new Map(selectionInput.candidates.map((c) => [c.candidateKey, c]));
  const fairnessByKey = new Map(selectionInput.fairnessFacts.map((f) => [f.candidateKey, f]));
  const sameDayExcludedPharmacyIds = new Set<string>();
  // Applies the SAME_DAY_ASSIGNMENT_LIMIT, in-run, non-relaxable check
  // to any candidateKey — reused below for both the original
  // strict∪relaxed union and any sequentially-widened candidates, so a
  // pharmacy already picked earlier THIS date can never re-enter
  // through either path.
  const passesSameDayCheck = (candidateKey: string): boolean => {
    const candidate = candidateByKey.get(candidateKey);
    if (!candidate) return false; // defensive; cannot happen for a validated SelectionInput
    const acc = accumulator.get(candidate.pharmacyId) ?? EMPTY_ENTRY;
    if (!sameDaySecondAssignmentAllowed && acc.newestLastDutyDate === date) {
      sameDayExcludedPharmacyIds.add(candidate.pharmacyId);
      return false;
    }
    return true;
  };

  const eligibleToday: string[] = [];
  for (const candidateKey of available) {
    if (!candidateByKey.has(candidateKey)) continue; // defensive
    if (passesSameDayCheck(candidateKey)) eligibleToday.push(candidateKey);
  }

  // Part 8 boundary (explicit, not silent — see this file's header
  // comment): the sequential layer ONLY re-derives MIN_DAYS_BETWEEN_
  // DUTIES against in-run state. A candidate Phase 4/5 already placed in
  // relaxedEligible (for the built-in interval reason, a configured
  // relaxable rule, or both — applyEligibilityRelaxation's policy is
  // "relax-admissible iff EVERY hard failure is a relaxable reason", so
  // relaxedEligible membership does not distinguish WHICH relaxable
  // reason(s) applied) is NEVER promoted back to strict here: doing so
  // would silently override whatever non-interval relaxable rule Phase
  // 4/5 actually evaluated, using only this module's narrow interval
  // check, and this module has no way to re-verify a chamber-configured
  // rule's condition. Only candidates Phase 4/5 ALREADY classified
  // strictEligible (meaning interval was their only possible relaxable
  // concern, since strict requires zero hard failures of any kind) are
  // re-examined against the accumulator's updated lastDutyDate — that is
  // the one fact this module legitimately owns and can correctly update.
  const originallyStrict = new Set(selectionInput.relaxation.strictEligible);
  const strict: string[] = [];
  for (const candidateKey of eligibleToday) {
    if (!originallyStrict.has(candidateKey)) continue;
    const candidate = candidateByKey.get(candidateKey)!;
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

  // SEQUENTIAL-RELAXATION-CONTRACT CORRECTIVE: only when the
  // accumulator-adjusted strict count can no longer fill requiredCount
  // do we widen the universe beyond Phase 4's static strict∪relaxed
  // union. This exactly mirrors V1's own trigger condition
  // (`strictlyEligible.length < dailyDutyCount`) — re-evaluated HERE,
  // against CURRENT in-run state, rather than trusting Phase 4's
  // one-time static evaluation of the same condition.
  const sequentiallyRelaxedCandidateKeys: string[] = [];
  let widenedEligibleToday = eligibleToday;
  if (relaxMinIntervalWhenInsufficient && strict.length < selectionInput.requiredCount) {
    const relaxableSet = new Set(selectionInput.relaxableReasonCodes);
    const alreadyConsidered = new Set(eligibleToday);
    const additional: string[] = [];
    for (const eligibilityResult of selectionInput.eligibility) {
      const candidateKey = eligibilityResult.candidateKey;
      if (alreadyConsidered.has(candidateKey)) continue; // already in eligibleToday
      // The EXACT SAME predicate Phase 4 uses — never re-invented, never
      // re-evaluating a configured HARD rule's condition. A candidate
      // failing anything non-relaxable (inactive, unavailable, blocking,
      // exclusion, a non-relaxable configured rule, …) is never admitted.
      if (!isRelaxAdmissible(eligibilityResult, relaxableSet)) continue;
      if (!passesSameDayCheck(candidateKey)) continue;
      additional.push(candidateKey);
    }
    if (additional.length > 0) {
      sequentiallyRelaxedCandidateKeys.push(...additional.sort());
      widenedEligibleToday = [...eligibleToday, ...additional];
    }
  }

  const pool = strict.length >= selectionInput.requiredCount ? strict : widenedEligibleToday;
  const strictSet = new Set(strict);
  const origin = new Map<string, "STRICT" | "RELAXED">();
  for (const key of pool) {
    origin.set(key, strictSet.has(key) ? "STRICT" : "RELAXED");
  }
  return {
    origin,
    sameDayExcludedPharmacyIds: [...sameDayExcludedPharmacyIds].sort(),
    sequentiallyRelaxedCandidateKeys,
  };
}

/** Fold one slot's provisional selection into the accumulator. Pure:
 *  returns a NEW accumulator map, never mutates its input. */
export function updateAccumulatorWithSelection(
  accumulator: SequentialAccumulator,
  selection: ProvisionalSlotSelection,
  facts: readonly CandidateRankingFacts[],
  isWeekendDate: boolean,
  isSundayDate: boolean,
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
      addedSundayCount: prior.addedSundayCount + (isSundayDate ? 1 : 0),
      addedHolidayCount: prior.addedHolidayCount + (isHolidayDate ? 1 : 0),
      newestLastDutyDate: selection.date,
    });
  }
  return next;
}

export type SequentialSlotInput = {
  selectionInput: SelectionInput;
  matchContextBase: Omit<Parameters<typeof buildStrategyMatchContext>[0], "selectionInput">;
  isWeekendDate: boolean;
  isSundayDate: boolean;
  isHolidayDate: boolean;
};

/** Deterministic chronological + within-date ordering: date ascending,
 *  then slotKey ascending (slotKey is itself date-prefixed, so this is
 *  simply "sort by slotKey" — but expressed explicitly by date first so
 *  the ordering intent is not an accident of string prefixing). */
function chronologicalOrder(a: SequentialSlotInput, b: SequentialSlotInput): number {
  const dateA = a.selectionInput.slot.date;
  const dateB = b.selectionInput.slot.date;
  if (dateA !== dateB) return dateA < dateB ? -1 : 1;
  const keyA = a.selectionInput.slot.slotKey;
  const keyB = b.selectionInput.slot.slotKey;
  return keyA < keyB ? -1 : keyA > keyB ? 1 : 0;
}

/**
 * The period-level orchestrator: selects provisional winners for every
 * given slot, carrying the sequential accumulator forward. Pure,
 * deterministic, no database access, no RotationState mutation.
 *
 * Part 3 (chronological-order safety): this function does NOT rely
 * solely on caller ordering discipline — it normalizes internally (sorts
 * by date then slotKey) and defensively rejects duplicate slotKeys with
 * a typed error, so equivalent semantic input (any input order,
 * including reversed or shuffled) always produces identical output.
 */
export function selectProvisionalWinnersSequential(input: {
  slots: SequentialSlotInput[];
  minDaysBetweenDuties: number;
  sameDaySecondAssignmentAllowed: boolean;
  /** Mirrors EngineSchedulingPolicy.relaxMinIntervalWhenInsufficient —
   *  gates BOTH Phase 4's static relaxation AND this module's sequential
   *  widening (see resolveSequentialCandidateSet). */
  relaxMinIntervalWhenInsufficient: boolean;
  definitions: ConfiguredSelectionStrategy[];
  definitionsById: ReadonlyMap<string, ConfiguredSelectionStrategy>;
}): ProvisionalSlotSelection[] {
  const ordered = [...input.slots].sort(chronologicalOrder);

  const seenSlotKeys = new Set<string>();
  for (const slot of ordered) {
    const slotKey = slot.selectionInput.slot.slotKey;
    if (seenSlotKeys.has(slotKey)) {
      throw new SelectionEngineError(
        "DUPLICATE_SLOT_IN_PERIOD",
        "Aynı slot dönem seçimine birden fazla kez verildi.",
        [slotKey]
      );
    }
    seenSlotKeys.add(slotKey);
  }

  const results: ProvisionalSlotSelection[] = [];
  let accumulator: SequentialAccumulator = new Map();

  for (const { selectionInput, matchContextBase, isWeekendDate, isSundayDate, isHolidayDate } of ordered) {
    const { origin, sameDayExcludedPharmacyIds, sequentiallyRelaxedCandidateKeys } = resolveSequentialCandidateSet(
      selectionInput,
      accumulator,
      input.minDaysBetweenDuties,
      input.sameDaySecondAssignmentAllowed,
      input.relaxMinIntervalWhenInsufficient
    );
    const baseFacts = buildCandidateRankingFacts(selectionInput, origin);
    const adjustedFacts = applyAccumulatorToFacts(baseFacts, accumulator, selectionInput.slot.date);
    const matchContext = buildStrategyMatchContext({ ...matchContextBase, selectionInput });

    let result = selectProvisionalWinnersFromFacts({
      slotKey: selectionInput.slot.slotKey,
      date: selectionInput.slot.date,
      requiredCount: selectionInput.requiredCount,
      rankingFacts: adjustedFacts,
      matchContext,
      definitions: input.definitions,
      definitionsById: input.definitionsById,
    });
    if (sameDayExcludedPharmacyIds.length > 0) {
      result = {
        ...result,
        diagnostics: [
          ...result.diagnostics,
          {
            code: "PROVISIONAL_SAME_DAY_ASSIGNMENT_CONFLICT",
            date: selectionInput.slot.date,
            subjectKey: selectionInput.slot.slotKey,
          },
        ],
      };
    }
    if (sequentiallyRelaxedCandidateKeys.length > 0) {
      const strictCount = [...origin.values()].filter((o) => o === "STRICT").length;
      result = {
        ...result,
        diagnostics: [
          ...result.diagnostics,
          {
            code: "SEQUENTIAL_RELAXATION_APPLIED",
            date: selectionInput.slot.date,
            subjectKey: `${selectionInput.slot.slotKey}#required=${selectionInput.requiredCount}#strict=${strictCount}#relaxed=${sequentiallyRelaxedCandidateKeys.length}`,
          },
        ],
      };
    }
    results.push(result);

    accumulator = updateAccumulatorWithSelection(
      accumulator,
      result,
      adjustedFacts,
      isWeekendDate,
      isSundayDate,
      isHolidayDate
    );
  }

  return results;
}
