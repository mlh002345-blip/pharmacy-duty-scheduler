// Duty Rules V2 — Phase 7: pure assembly of DraftSlot/DraftAssignment
// facts from an already-computed DutyEngineDraftResult. This module
// NEVER re-ranks, re-selects, excludes, or resurrects a candidate — it
// only restates Phase 4-6's own decisions in the Complete Draft shape,
// while recording any structural inconsistency it observes as a
// DraftDiagnostic instead of silently tolerating or "fixing" it.

import type { EngineDraftResultPreDraft } from "../engine/build-draft-result";
import type { ResolvedSlot } from "../engine/resolve-slots";
import type { SelectionInput } from "../engine/build-selection-input";
import type { ProvisionalSlotSelection } from "../selection/domain/selection-result";
import { makeDraftDiagnostic, type DraftDiagnostic } from "./domain/draft-diagnostic";
import type { DraftAssignment, DraftSlot, DraftSlotStatus } from "./domain/draft-schedule";

const SLOT_KEY_SHAPE = /^\d{4}-\d{2}-\d{2}:.+:.+:\d+$/;

export type AssembledSlot = {
  slot: DraftSlot;
  diagnostics: DraftDiagnostic[];
};

export function assembleDraftSlot(input: {
  resolvedSlot: ResolvedSlot;
  periodStart: string;
  periodEnd: string;
  hasAnyStrategyConfigured: boolean;
  selectionInput: SelectionInput | null;
  provisional: ProvisionalSlotSelection | null;
}): AssembledSlot {
  const { resolvedSlot } = input;
  const diagnostics: DraftDiagnostic[] = [];

  if (!SLOT_KEY_SHAPE.test(resolvedSlot.slotKey)) {
    diagnostics.push(makeDraftDiagnostic("DRAFT_SLOT_KEY_FORMAT_INVALID", resolvedSlot.date, resolvedSlot.slotKey));
  }
  if (resolvedSlot.date < input.periodStart || resolvedSlot.date > input.periodEnd) {
    diagnostics.push(
      makeDraftDiagnostic("DRAFT_PERIOD_BOUNDARY_VIOLATION", resolvedSlot.date, resolvedSlot.slotKey)
    );
  }

  if (!resolvedSlot.resolvable) {
    diagnostics.push(makeDraftDiagnostic("DRAFT_SLOT_WITHOUT_POOL", resolvedSlot.date, resolvedSlot.slotKey));
    return {
      slot: baseSlot(resolvedSlot, "UNSCHEDULED", [], diagnostics),
      diagnostics,
    };
  }

  if (!input.hasAnyStrategyConfigured || input.provisional === null) {
    if (resolvedSlot.requiredCount > 0) {
      diagnostics.push(
        makeDraftDiagnostic("DRAFT_SLOT_UNRESOLVED_NO_STRATEGY", resolvedSlot.date, resolvedSlot.slotKey)
      );
    }
    return {
      slot: baseSlot(resolvedSlot, resolvedSlot.requiredCount > 0 ? "UNRESOLVED" : "FILLED", [], diagnostics),
      diagnostics,
    };
  }

  const provisional = input.provisional;
  const strictSet = new Set(input.selectionInput?.relaxation.strictEligible ?? []);
  const relaxedSet = new Set(input.selectionInput?.relaxation.relaxedEligible ?? []);
  const candidatePharmacyIds = new Set(
    (input.selectionInput?.candidates ?? []).map((c) => c.pharmacyId)
  );
  const fallbackUsedOnSlot = provisional.diagnostics.some((d) => d.code === "FALLBACK_USED");

  if (provisional.selectedCandidateKeys.length > 0 && provisional.strategyId === null) {
    diagnostics.push(
      makeDraftDiagnostic("DRAFT_STRATEGY_MISSING_FOR_SELECTED_SLOT", resolvedSlot.date, resolvedSlot.slotKey)
    );
  }

  const rankingByKey = new Map(provisional.rankings.map((r) => [r.candidateKey, r]));
  const assignments: DraftAssignment[] = [];
  const seenPharmacyIds = new Set<string>();
  let previousRank = -Infinity;
  let rankMonotonic = true;

  provisional.selectedCandidateKeys.forEach((candidateKey, index) => {
    const ranking = rankingByKey.get(candidateKey);
    if (!ranking) {
      diagnostics.push(
        makeDraftDiagnostic(
          "DRAFT_ASSIGNMENT_REFERENCES_UNKNOWN_CANDIDATE",
          resolvedSlot.date,
          `${resolvedSlot.slotKey}#${candidateKey}`
        )
      );
      return;
    }

    const expectedOrdinal = index + 1;
    if (ranking.selectionOrdinal !== null && ranking.selectionOrdinal < previousRank) {
      rankMonotonic = false;
    }
    if (ranking.provisionalRank >= previousRank) {
      previousRank = ranking.provisionalRank;
    } else {
      rankMonotonic = false;
    }

    if (ranking.rankFacts.pharmacyId !== undefined && seenPharmacyIds.has(ranking.rankFacts.pharmacyId)) {
      diagnostics.push(
        makeDraftDiagnostic("DRAFT_SAME_SLOT_DUPLICATE_PHARMACY", resolvedSlot.date, resolvedSlot.slotKey)
      );
    }
    seenPharmacyIds.add(ranking.rankFacts.pharmacyId);

    const origin: "STRICT" | "RELAXED" = strictSet.has(candidateKey)
      ? "STRICT"
      : relaxedSet.has(candidateKey)
        ? "RELAXED"
        : ranking.rankFacts.origin;
    if (!strictSet.has(candidateKey) && !relaxedSet.has(candidateKey)) {
      diagnostics.push(
        makeDraftDiagnostic(
          "DRAFT_CANDIDATE_NOT_IN_STRICT_OR_RELAXED",
          resolvedSlot.date,
          `${resolvedSlot.slotKey}#${candidateKey}`
        )
      );
    }
    if (candidatePharmacyIds.size > 0 && !candidatePharmacyIds.has(ranking.rankFacts.pharmacyId)) {
      diagnostics.push(
        makeDraftDiagnostic(
          "DRAFT_UNKNOWN_PHARMACY_REFERENCE",
          resolvedSlot.date,
          `${resolvedSlot.slotKey}#${ranking.rankFacts.pharmacyId}`
        )
      );
    }

    if (provisional.date !== resolvedSlot.date) {
      diagnostics.push(
        makeDraftDiagnostic("DRAFT_SLOT_DATE_MISMATCH", resolvedSlot.date, resolvedSlot.slotKey)
      );
    }

    assignments.push({
      assignmentKey: `${resolvedSlot.slotKey}#${candidateKey}`,
      slotKey: resolvedSlot.slotKey,
      date: provisional.date,
      candidateKey,
      pharmacyId: ranking.rankFacts.pharmacyId,
      pharmacyName: ranking.rankFacts.pharmacyName,
      origin,
      strategyId: provisional.strategyId,
      strategyType: provisional.strategyType,
      provisionalRank: ranking.provisionalRank,
      selectionOrdinal: expectedOrdinal,
      fallbackUsed: fallbackUsedOnSlot,
    });
  });

  if (!rankMonotonic) {
    diagnostics.push(makeDraftDiagnostic("DRAFT_RANK_NOT_MONOTONIC", resolvedSlot.date, resolvedSlot.slotKey));
  }
  if (assignments.length !== provisional.selectedCandidateKeys.length) {
    diagnostics.push(
      makeDraftDiagnostic("DRAFT_ASSIGNMENT_COUNT_MISMATCH_SELECTION", resolvedSlot.date, resolvedSlot.slotKey)
    );
  }
  if (assignments.length > resolvedSlot.requiredCount) {
    diagnostics.push(
      makeDraftDiagnostic("DRAFT_ASSIGNMENT_COUNT_EXCEEDS_REQUIRED", resolvedSlot.date, resolvedSlot.slotKey)
    );
  }

  const expectedOrdinals = assignments.map((a) => a.selectionOrdinal);
  const contiguous = expectedOrdinals.every((ordinal, i) => ordinal === i + 1);
  if (!contiguous) {
    diagnostics.push(
      makeDraftDiagnostic("DRAFT_SELECTION_ORDINAL_GAP", resolvedSlot.date, resolvedSlot.slotKey)
    );
  }

  let status: DraftSlotStatus;
  if (resolvedSlot.requiredCount === 0) {
    status = "FILLED";
  } else if (provisional.unresolved && assignments.length === 0) {
    status = "UNRESOLVED";
  } else if (assignments.length < resolvedSlot.requiredCount) {
    status = "UNDERFILLED";
    diagnostics.push(makeDraftDiagnostic("DRAFT_SLOT_UNDERFILLED", resolvedSlot.date, resolvedSlot.slotKey));
  } else {
    status = "FILLED";
  }

  return {
    slot: baseSlot(resolvedSlot, status, assignments, diagnostics),
    diagnostics,
  };
}

function baseSlot(
  resolvedSlot: ResolvedSlot,
  status: DraftSlotStatus,
  assignments: DraftAssignment[],
  diagnostics: DraftDiagnostic[] = []
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
    status,
    assignments,
    diagnostics,
  };
}

export function assembleDraftDays(
  result: EngineDraftResultPreDraft
): { slot: DraftSlot; diagnostics: DraftDiagnostic[] }[][] {
  const selectionInputBySlotKey = new Map(result.selectionInputs.map((si) => [si.slot.slotKey, si]));
  const provisionalBySlotKey = new Map(result.provisionalSelections.map((p) => [p.slotKey, p]));
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
        periodStart: result.periodStart,
        periodEnd: result.periodEnd,
        hasAnyStrategyConfigured,
        selectionInput: selectionInputBySlotKey.get(resolvedSlot.slotKey) ?? null,
        provisional: provisionalBySlotKey.get(resolvedSlot.slotKey) ?? null,
      })
    )
  );
}
