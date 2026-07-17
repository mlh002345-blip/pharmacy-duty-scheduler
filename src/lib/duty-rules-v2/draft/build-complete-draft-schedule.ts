// Duty Rules V2 — Phase 7: Complete Draft Schedule orchestrator.
//
// assembleCompleteDraftSchedule(...) is the single entry point:
//   1. assemble DraftDay/DraftSlot/DraftAssignment facts (pure
//      projection only — assemble-draft-slots.ts never decides whether
//      something is a diagnostic).
//   2. run every validator (reference, capacity, eligibility-origin,
//      cross-slot, chronology/identity, completeness/summary) — each
//      owns a disjoint slice of the diagnostic catalogue and NEVER
//      repairs or drops data, only reports.
//   3. classify the overall status, compute the fingerprint + manifest.
//
// Pure, deterministic, no database access, no mutation of its input, no
// re-ranking — see docs/architecture/DUTY_RULES_V2_COMPLETE_DRAFT_GENERATION.md
// for the full validator-boundary table and status/fingerprint contract.

import type { EngineDraftResultPreDraft } from "../engine/build-draft-result";
import { assembleDraftDays } from "./assemble-draft-slots";
import { dedupedDiagnosticCodes, sortDraftDiagnostics } from "./domain/draft-diagnostic";
import type {
  CompleteDraftSchedule,
  CompleteDraftStatus,
  DraftDay,
  DraftValidationSummary,
} from "./domain/draft-schedule";
import { validateDraftReferences } from "./validate-draft-references";
import { validateDraftCapacity } from "./validate-draft-capacity";
import { validateDraftEligibilityOrigin } from "./validate-draft-eligibility-origin";
import { validateDraftCrossSlot } from "./validate-draft-cross-slot";
import { validateDraftChronology } from "./validate-draft-chronology";
import { validateDraftDaySummaries, validateDraftPeriodSummary } from "./validate-draft-completeness";
import { computeCompleteDraftFingerprint } from "./fingerprint-complete-draft";

export function assembleCompleteDraftSchedule(
  result: EngineDraftResultPreDraft,
  options: { sameDaySecondAssignmentAllowed: boolean }
): CompleteDraftSchedule {
  const assembledSlotsByDay = assembleDraftDays(result, options.sameDaySecondAssignmentAllowed);
  const hasAnyStrategyConfigured = result.provisionalSelections.length > 0;

  const days: DraftDay[] = result.days.map((day, dayIndex) => {
    const slots = assembledSlotsByDay[dayIndex];
    const requiredCount = slots.reduce((sum, s) => sum + s.requiredCount, 0);
    const selectedCount = slots.reduce((sum, s) => sum + s.selectedCount, 0);
    const missingCount = slots.reduce((sum, s) => sum + s.missingCount, 0);
    const status: DraftDay["status"] =
      slots.length > 0 && slots.every((s) => s.status === "UNSCHEDULED")
        ? "UNSCHEDULED"
        : slots.some((s) => s.status === "UNDERFILLED")
          ? "UNDERFILLED"
          : slots.some((s) => s.status === "UNRESOLVED")
            ? "UNRESOLVED"
            : "FILLED";
    return {
      date: day.date,
      weekdayName: day.calendar.weekdayName,
      dayTypeKey: day.dayType.dayType,
      compatibilityWeightDayType:
        day.dayType.dayType === "HOLIDAY_EVE" ? day.calendar.compatibilityWeightDayType : null,
      isHolidayEve: day.calendar.isHolidayEve,
      holidays: day.calendar.holidays.map((h) => ({ type: h.type, name: h.name })),
      served: day.dayType.served === true,
      requiredCount,
      selectedCount,
      missingCount,
      status,
      slotKeys: [...slots.map((s) => s.slotKey)].sort(),
      assignmentKeys: [...slots.flatMap((s) => s.assignments.map((a) => a.draftAssignmentKey))].sort(),
      slots,
    };
  });

  const allSlots = days.flatMap((day) => day.slots);
  const assignments = allSlots
    .flatMap((slot) => slot.assignments)
    .sort((a, b) => (a.draftAssignmentKey < b.draftAssignmentKey ? -1 : a.draftAssignmentKey > b.draftAssignmentKey ? 1 : 0));

  const referenceDiagnostics = validateDraftReferences({ result, slots: allSlots });
  const capacityDiagnostics = validateDraftCapacity({ slots: allSlots, hasAnyStrategyConfigured });
  const originDiagnostics = validateDraftEligibilityOrigin({ result, slots: allSlots });
  const crossSlotDiagnostics = validateDraftCrossSlot({
    assignments,
    sameDaySecondAssignmentAllowed: options.sameDaySecondAssignmentAllowed,
  });
  const chronologyDiagnostics = validateDraftChronology({
    slots: allSlots,
    periodStart: result.periodStart,
    periodEnd: result.periodEnd,
  });
  const daySummaryDiagnostics = validateDraftDaySummaries(days);

  const diagnosticsWithoutPeriodSummary = sortDraftDiagnostics([
    ...referenceDiagnostics,
    ...capacityDiagnostics,
    ...originDiagnostics,
    ...crossSlotDiagnostics,
    ...chronologyDiagnostics,
    ...daySummaryDiagnostics,
  ]);

  // Attach every diagnostic whose subjectKey belongs to a given slot
  // (either "{slotKey}" or "{slotKey}#...") back onto that slot, without
  // re-deciding anything — pure re-projection of the flat list above.
  for (const slot of allSlots) {
    slot.diagnostics = diagnosticsWithoutPeriodSummary.filter(
      (d) => d.subjectKey === slot.slotKey || d.subjectKey.startsWith(`${slot.slotKey}#`)
    );
  }

  const counts = {
    totalSlots: allSlots.length,
    filledSlots: allSlots.filter((s) => s.status === "FILLED").length,
    underfilledSlots: allSlots.filter((s) => s.status === "UNDERFILLED").length,
    unresolvedSlots: allSlots.filter((s) => s.status === "UNRESOLVED").length,
    unscheduledSlots: allSlots.filter((s) => s.status === "UNSCHEDULED").length,
    totalAssignments: assignments.length,
  };

  const periodSummaryDiagnostics = validateDraftPeriodSummary({
    days,
    counts,
    assignments,
    periodStart: result.periodStart,
    periodEnd: result.periodEnd,
  });

  const diagnostics = sortDraftDiagnostics([...diagnosticsWithoutPeriodSummary, ...periodSummaryDiagnostics]);

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

  const completeDraftFingerprint = computeCompleteDraftFingerprint({
    ...withoutFingerprint,
    sourceResultFingerprint: result.resultFingerprint,
  });

  return {
    ...withoutFingerprint,
    manifest: {
      planVersionId: result.provenance.planVersionId,
      organizationId: result.provenance.organizationId,
      regionId: result.provenance.regionId,
      periodStart: result.periodStart,
      periodEnd: result.periodEnd,
      status,
      isCommitEligible,
      counts,
      sourceResultFingerprint: result.resultFingerprint,
      provenance: result.provenance,
      generatedFromProvisionalSelectionsCount: result.provisionalSelections.length,
      completeDraftFingerprint,
      assignmentKeys: assignments.map((a) => a.draftAssignmentKey),
      unresolvedSlotKeys: allSlots.filter((s) => s.status === "UNRESOLVED").map((s) => s.slotKey).sort(),
      underfilledSlotKeys: allSlots.filter((s) => s.status === "UNDERFILLED").map((s) => s.slotKey).sort(),
      blockingDiagnosticCodes: dedupedDiagnosticCodes(diagnostics.filter((d) => d.severity === "ERROR")),
      validation,
    },
    completeDraftFingerprint,
  };
}
