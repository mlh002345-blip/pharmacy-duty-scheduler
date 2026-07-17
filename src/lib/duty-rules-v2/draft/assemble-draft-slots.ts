// Duty Rules V2 — Phase 7: pure assembly of DraftSlot/DraftAssignment
// facts from an already-computed DutyEngineDraftResult.
//
// PURE PROJECTION ONLY. This module NEVER re-ranks, re-selects,
// excludes, or resurrects a candidate, and it NEVER decides whether a
// structural inconsistency is a diagnostic — that is entirely the
// validators' job (validate-draft-*.ts). Assembly does its best-effort
// construction (e.g. an unresolvable candidateKey simply cannot produce
// an assignment fact — there is no pharmacyId to project), and the
// validators independently re-derive expectations from the same source
// data to catch every case where assembly's best effort fell short.

import type { EngineDraftResultPreDraft } from "../engine/build-draft-result";
import type { ResolvedSlot } from "../engine/resolve-slots";
import type { SelectionInput } from "../engine/build-selection-input";
import type { ProvisionalSlotSelection } from "../selection/domain/selection-result";
import type { SelectionExplanation } from "../selection/build-selection-explanations";
import type { DraftAssignment, DraftSlot, DraftSlotStatus } from "./domain/draft-schedule";

/** "{slotKey}#{membershipId}" → membershipId (the last '#'-delimited
 *  segment; slotKey itself never contains '#', see resolve-slots.ts). */
function membershipIdFromCandidateKey(candidateKey: string): string {
  const parts = candidateKey.split("#");
  return parts[parts.length - 1];
}

export function assembleDraftSlot(input: {
  resolvedSlot: ResolvedSlot;
  resolvedDayType: string | null;
  compatibilityWeightDayType: "WEEKDAY" | "SATURDAY" | "SUNDAY" | null;
  planVersionId: string;
  hasAnyStrategyConfigured: boolean;
  selectionInput: SelectionInput | null;
  provisional: ProvisionalSlotSelection | null;
  explanationsByCandidateKey: ReadonlyMap<string, SelectionExplanation>;
}): DraftSlot {
  const { resolvedSlot } = input;

  if (!resolvedSlot.resolvable) {
    return baseSlot(resolvedSlot, "UNSCHEDULED", [], null, null, false);
  }

  if (!input.hasAnyStrategyConfigured || input.provisional === null) {
    return baseSlot(
      resolvedSlot,
      resolvedSlot.requiredCount > 0 ? "UNRESOLVED" : "FILLED",
      [],
      null,
      null,
      false
    );
  }

  const provisional = input.provisional;
  const selectionInput = input.selectionInput;
  const fairnessByCandidateKey = new Map((selectionInput?.fairnessFacts ?? []).map((f) => [f.candidateKey, f]));
  const ruleRefsByCandidateKey = new Map<string, string[]>();
  for (const rule of selectionInput?.ruleEvaluations ?? []) {
    if (rule.candidateKey === null || rule.outcome === "PASS") continue;
    const list = ruleRefsByCandidateKey.get(rule.candidateKey) ?? [];
    list.push(rule.violationCode ?? rule.explanationCode);
    ruleRefsByCandidateKey.set(rule.candidateKey, list);
  }
  const fallbackUsedOnSlot = provisional.diagnostics.some((d) => d.code === "FALLBACK_USED");

  const rankingByKey = new Map(provisional.rankings.map((r) => [r.candidateKey, r]));
  const assignments: DraftAssignment[] = [];

  provisional.selectedCandidateKeys.forEach((candidateKey, index) => {
    const ranking = rankingByKey.get(candidateKey);
    if (!ranking) return; // Unresolvable: validate-draft-references.ts reports this.

    // ranking.rankFacts.origin is Phase 6's own authoritative per-
    // candidate origin (apply-sequential-selection-state.ts's origin
    // map) — the single source of truth, correct for both a Phase-4-
    // static-relaxed candidate and one admitted only via Phase 6's
    // sequential-relaxation widening (sequential-relaxation-contract
    // corrective). Phase 4's static strictEligible/relaxedEligible sets
    // are a one-time, single-slot snapshot and can go stale once the
    // sequential accumulator later demotes a candidate Phase 4 saw as
    // strict — using them here would silently relabel a RELAXED
    // assignment as STRICT.
    const origin: "STRICT" | "RELAXED" = ranking.rankFacts.origin;
    const explanation = input.explanationsByCandidateKey.get(candidateKey) ?? null;
    const fairness = fairnessByCandidateKey.get(candidateKey) ?? null;

    assignments.push({
      draftAssignmentKey: `${resolvedSlot.slotKey}#${candidateKey}`,
      slotKey: resolvedSlot.slotKey,
      date: provisional.date,
      shiftId: resolvedSlot.shiftId,
      shiftKey: resolvedSlot.shiftKey,
      poolId: resolvedSlot.poolId,
      candidateKey,
      membershipId: membershipIdFromCandidateKey(candidateKey),
      pharmacyId: ranking.rankFacts.pharmacyId,
      pharmacyName: ranking.rankFacts.pharmacyName,
      origin,
      strategyId: provisional.strategyId,
      strategyType: provisional.strategyType,
      provisionalRank: ranking.provisionalRank,
      selectionOrdinal: index + 1,
      fallbackUsed: fallbackUsedOnSlot,
      dutyWeight: fairness?.dateWeight ?? 0,
      resolvedDayType: input.resolvedDayType,
      compatibilityWeightDayType: input.compatibilityWeightDayType,
      decisiveComparatorCriterion: explanation?.decisiveCriterion ?? null,
      ruleExplanationRefs: [...(ruleRefsByCandidateKey.get(candidateKey) ?? [])].sort(),
      sourceProvenance: {
        configurationFingerprint: selectionInput?.provenance.configurationFingerprint ?? "",
        runtimeInputHash: selectionInput?.provenance.runtimeInputHash ?? "",
        ruleSetFingerprint: selectionInput?.provenance.ruleSetFingerprint ?? "",
        strategySetFingerprint: selectionInput?.provenance.strategySetFingerprint ?? "",
        membershipSnapshotHash: selectionInput?.provenance.membershipSnapshotHash ?? "",
      },
    });
  });

  let status: DraftSlotStatus;
  if (resolvedSlot.requiredCount === 0) {
    status = "FILLED";
  } else if (provisional.unresolved && assignments.length === 0) {
    status = "UNRESOLVED";
  } else if (assignments.length < resolvedSlot.requiredCount) {
    status = "UNDERFILLED";
  } else {
    status = "FILLED";
  }

  return baseSlot(
    resolvedSlot,
    status,
    assignments,
    provisional,
    selectionInput,
    fallbackUsedOnSlot
  );
}

function baseSlot(
  resolvedSlot: ResolvedSlot,
  status: DraftSlotStatus,
  assignments: DraftAssignment[],
  provisional: ProvisionalSlotSelection | null,
  selectionInput: SelectionInput | null,
  fallbackUsed: boolean
): DraftSlot {
  return {
    slotKey: resolvedSlot.slotKey,
    date: resolvedSlot.date,
    dayTypeKey: resolvedSlot.dayTypeKey,
    shiftId: resolvedSlot.shiftId,
    shiftKey: resolvedSlot.shiftKey,
    poolId: resolvedSlot.poolId,
    slotId: resolvedSlot.slotId,
    slotName: resolvedSlot.slotName,
    sortOrder: resolvedSlot.sortOrder,
    requiredCount: resolvedSlot.requiredCount,
    selectedCount: assignments.length,
    missingCount: Math.max(0, resolvedSlot.requiredCount - assignments.length),
    status,
    strategyId: provisional?.strategyId ?? null,
    strategyType: provisional?.strategyType ?? null,
    fallbackUsed,
    relaxation: {
      strictEligibleCount: selectionInput?.relaxation.strictEligible.length ?? 0,
      relaxedEligibleCount: selectionInput?.relaxation.relaxedEligible.length ?? 0,
      relaxationApplied: selectionInput?.relaxation.relaxationApplied ?? false,
    },
    assignments,
    ruleDiagnosticRefs: [
      ...new Set((selectionInput?.ruleEvaluations ?? []).filter((r) => r.outcome !== "PASS").map((r) => r.violationCode ?? r.explanationCode)),
    ].sort(),
    strategyDiagnosticRefs: [...new Set((provisional?.diagnostics ?? []).map((d) => d.code))].sort(),
    explanationRefs: assignments.map((a) => a.candidateKey).sort(),
    diagnostics: [],
  };
}

export function assembleDraftDays(
  result: EngineDraftResultPreDraft,
  sameDaySecondAssignmentAllowed: boolean
): DraftSlot[][] {
  void sameDaySecondAssignmentAllowed; // cross-slot checks run at orchestrator level, not here.
  const selectionInputBySlotKey = new Map(result.selectionInputs.map((si) => [si.slot.slotKey, si]));
  const provisionalBySlotKey = new Map(result.provisionalSelections.map((p) => [p.slotKey, p]));
  const explanationsByCandidateKey = new Map(result.selectionExplanations.map((e) => [e.candidateKey, e]));
  // A provisional selection exists for every resolvable slot whenever at
  // least one selection strategy is configured (build-engine-context.ts
  // always pushes one pendingSelectionSlot per resolvable slot). The
  // presence of ANY provisional selection is therefore a reliable,
  // input-only signal that strategies were configured for this run.
  const hasAnyStrategyConfigured = result.provisionalSelections.length > 0;

  return result.days.map((day) =>
    day.slots.map((resolvedSlot) =>
      assembleDraftSlot({
        resolvedSlot,
        resolvedDayType: day.dayType.dayType,
        compatibilityWeightDayType:
          day.dayType.dayType === "HOLIDAY_EVE" ? day.calendar.compatibilityWeightDayType : null,
        planVersionId: result.provenance.planVersionId,
        hasAnyStrategyConfigured,
        selectionInput: selectionInputBySlotKey.get(resolvedSlot.slotKey) ?? null,
        provisional: provisionalBySlotKey.get(resolvedSlot.slotKey) ?? null,
        explanationsByCandidateKey,
      })
    )
  );
}
