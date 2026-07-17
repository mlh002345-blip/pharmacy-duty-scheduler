// Duty Rules V2 — Phase 7: completeness / summary-consistency validation.
//
// Re-derives every day-level and period-level count/key-list from the
// actual assembled slots and flags any place a precomputed summary
// field disagrees — summaries are never trusted, always re-checked.

import { makeDraftDiagnostic, type DraftDiagnostic } from "./domain/draft-diagnostic";
import type { CompleteDraftSchedule, DraftDay } from "./domain/draft-schedule";

export function validateDraftDaySummaries(days: DraftDay[]): DraftDiagnostic[] {
  const diagnostics: DraftDiagnostic[] = [];
  for (const day of days) {
    const requiredCount = day.slots.reduce((sum, s) => sum + s.requiredCount, 0);
    const selectedCount = day.slots.reduce((sum, s) => sum + s.selectedCount, 0);
    const missingCount = day.slots.reduce((sum, s) => sum + s.missingCount, 0);
    const slotKeys = [...day.slots.map((s) => s.slotKey)].sort();
    const assignmentKeys = [...day.slots.flatMap((s) => s.assignments.map((a) => a.draftAssignmentKey))].sort();

    const mismatched =
      requiredCount !== day.requiredCount ||
      selectedCount !== day.selectedCount ||
      missingCount !== day.missingCount ||
      JSON.stringify(slotKeys) !== JSON.stringify([...day.slotKeys].sort()) ||
      JSON.stringify(assignmentKeys) !== JSON.stringify([...day.assignmentKeys].sort());

    if (mismatched) {
      diagnostics.push(makeDraftDiagnostic("DRAFT_DAY_SUMMARY_INCONSISTENT", day.date, day.date));
    }
  }
  return diagnostics;
}

export function validateDraftPeriodSummary(
  draft: Pick<CompleteDraftSchedule, "days" | "counts" | "assignments" | "periodStart" | "periodEnd">
): DraftDiagnostic[] {
  const allSlots = draft.days.flatMap((d) => d.slots);
  const expected = {
    totalSlots: allSlots.length,
    filledSlots: allSlots.filter((s) => s.status === "FILLED").length,
    underfilledSlots: allSlots.filter((s) => s.status === "UNDERFILLED").length,
    unresolvedSlots: allSlots.filter((s) => s.status === "UNRESOLVED").length,
    unscheduledSlots: allSlots.filter((s) => s.status === "UNSCHEDULED").length,
    totalAssignments: allSlots.reduce((sum, s) => sum + s.assignments.length, 0),
  };
  const actual = draft.counts;
  const mismatched =
    expected.totalSlots !== actual.totalSlots ||
    expected.filledSlots !== actual.filledSlots ||
    expected.underfilledSlots !== actual.underfilledSlots ||
    expected.unresolvedSlots !== actual.unresolvedSlots ||
    expected.unscheduledSlots !== actual.unscheduledSlots ||
    expected.totalAssignments !== actual.totalAssignments ||
    draft.assignments.length !== expected.totalAssignments;

  return mismatched
    ? [makeDraftDiagnostic("DRAFT_PERIOD_SUMMARY_INCONSISTENT", null, `${draft.periodStart}..${draft.periodEnd}`)]
    : [];
}
