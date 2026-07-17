// Duty Rules V2 — Phase 7: Complete Draft Schedule orchestrator.
//
// assembleCompleteDraftSchedule(...) is the single entry point: assemble
// DraftDay/DraftSlot/DraftAssignment facts from an already-computed
// DutyEngineDraftResult (Phase 4-6 output), run reference/capacity/
// cross-slot/eligibility-origin validation, classify the overall status,
// and compute the fingerprint + manifest. Pure, deterministic, no
// database access, no mutation of its input, no re-ranking.

import type { EngineDraftResultPreDraft } from "../engine/build-draft-result";
import { assembleDraftDays } from "./assemble-draft-slots";
import { makeDraftDiagnostic, sortDraftDiagnostics, type DraftDiagnostic } from "./domain/draft-diagnostic";
import type {
  CompleteDraftSchedule,
  CompleteDraftStatus,
  DraftDay,
  DraftValidationSummary,
} from "./domain/draft-schedule";
import { validateDraftCrossSlot } from "./validate-draft-cross-slot";
import { computeCompleteDraftFingerprint } from "./fingerprint-complete-draft";

export function assembleCompleteDraftSchedule(
  result: EngineDraftResultPreDraft,
  options: { sameDaySecondAssignmentAllowed: boolean }
): CompleteDraftSchedule {
  const assembledDays = assembleDraftDays(result);

  const knownSlotKeys = new Set(result.days.flatMap((day) => day.slots.map((s) => s.slotKey)));
  const referenceDiagnostics: DraftDiagnostic[] = [];
  for (const provisional of result.provisionalSelections) {
    if (!knownSlotKeys.has(provisional.slotKey)) {
      referenceDiagnostics.push(
        makeDraftDiagnostic("DRAFT_ASSIGNMENT_REFERENCES_UNKNOWN_SLOT", provisional.date, provisional.slotKey)
      );
    }
  }

  const days: DraftDay[] = result.days.map((day, dayIndex) => ({
    date: day.date,
    dayTypeKey: day.dayType.dayType,
    served: day.dayType.served === true,
    slots: assembledDays[dayIndex].map((entry) => entry.slot),
  }));

  const assignments = days
    .flatMap((day) => day.slots.flatMap((slot) => slot.assignments))
    .sort((a, b) => (a.assignmentKey < b.assignmentKey ? -1 : a.assignmentKey > b.assignmentKey ? 1 : 0));

  const crossSlotDiagnostics = validateDraftCrossSlot({
    assignments,
    sameDaySecondAssignmentAllowed: options.sameDaySecondAssignmentAllowed,
  });

  const assemblyDiagnostics = assembledDays.flatMap((slots) => slots.flatMap((entry) => entry.diagnostics));

  const diagnostics = sortDraftDiagnostics([
    ...referenceDiagnostics,
    ...assemblyDiagnostics,
    ...crossSlotDiagnostics,
  ]);

  const allSlots = days.flatMap((day) => day.slots);
  const counts = {
    totalSlots: allSlots.length,
    filledSlots: allSlots.filter((s) => s.status === "FILLED").length,
    underfilledSlots: allSlots.filter((s) => s.status === "UNDERFILLED").length,
    unresolvedSlots: allSlots.filter((s) => s.status === "UNRESOLVED").length,
    unscheduledSlots: allSlots.filter((s) => s.status === "UNSCHEDULED").length,
    totalAssignments: assignments.length,
  };

  const errorCount = diagnostics.filter((d) => d.severity === "ERROR").length;
  const warningCount = diagnostics.filter((d) => d.severity === "WARNING").length;
  const infoCount = diagnostics.filter((d) => d.severity === "INFO").length;
  const validation: DraftValidationSummary = { errorCount, warningCount, infoCount };

  let status: CompleteDraftStatus;
  if (errorCount > 0) {
    status = "INVALID";
  } else if (counts.underfilledSlots > 0 || counts.unresolvedSlots > 0 || counts.unscheduledSlots > 0) {
    status = "PARTIAL";
  } else {
    status = "COMPLETE";
  }
  const isCommitEligible = status === "COMPLETE" && errorCount === 0;

  const withoutFingerprint = {
    engineVersion: result.engineVersion,
    selectionEngineVersion: result.provenance.selectionEngineVersion,
    generationMode: result.generationMode,
    periodStart: result.periodStart,
    periodEnd: result.periodEnd,
    provenance: result.provenance,
    days,
    assignments,
    counts,
    diagnostics,
    status,
    isCommitEligible,
  };

  const completeDraftFingerprint = computeCompleteDraftFingerprint(withoutFingerprint);

  return {
    ...withoutFingerprint,
    manifest: {
      sourceResultFingerprint: result.resultFingerprint,
      provenance: result.provenance,
      generatedFromProvisionalSelectionsCount: result.provisionalSelections.length,
      slotCount: counts.totalSlots,
      assignmentCount: counts.totalAssignments,
      validation,
      status,
      isCommitEligible,
    },
    completeDraftFingerprint,
  };
}
