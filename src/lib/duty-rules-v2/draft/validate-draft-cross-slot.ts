// Duty Rules V2 — Phase 7: cross-slot integrity checks over the fully
// assembled, flat DraftAssignment list. Pure; read-only; never mutates
// or drops an assignment — every violation is reported as a diagnostic
// alongside the (still-present) assignment it concerns.

import { makeDraftDiagnostic, type DraftDiagnostic } from "./domain/draft-diagnostic";
import type { DraftAssignment } from "./domain/draft-schedule";

export function validateDraftCrossSlot(input: {
  assignments: DraftAssignment[];
  sameDaySecondAssignmentAllowed: boolean;
}): DraftDiagnostic[] {
  const diagnostics: DraftDiagnostic[] = [];

  const seenAssignmentKeys = new Set<string>();
  for (const assignment of input.assignments) {
    if (seenAssignmentKeys.has(assignment.assignmentKey)) {
      diagnostics.push(
        makeDraftDiagnostic("DRAFT_DUPLICATE_ASSIGNMENT_KEY", assignment.date, assignment.assignmentKey)
      );
    }
    seenAssignmentKeys.add(assignment.assignmentKey);
    if (assignment.fallbackUsed) {
      diagnostics.push(
        makeDraftDiagnostic("DRAFT_FALLBACK_USED_ON_ASSIGNMENT", assignment.date, assignment.assignmentKey)
      );
    }
  }

  if (!input.sameDaySecondAssignmentAllowed) {
    const byDatePharmacy = new Map<string, DraftAssignment[]>();
    for (const assignment of input.assignments) {
      const key = `${assignment.date}#${assignment.pharmacyId}`;
      const list = byDatePharmacy.get(key) ?? [];
      list.push(assignment);
      byDatePharmacy.set(key, list);
    }
    for (const group of byDatePharmacy.values()) {
      if (group.length <= 1) continue;
      // Multiple seats on the same slot were already reported as
      // DRAFT_SAME_SLOT_DUPLICATE_PHARMACY at assembly time; this check
      // is specifically for the SAME pharmacy across DIFFERENT slots on
      // the same date, which the Phase 6 sequential accumulator already
      // prevents in-run — reported here as a defensive, independent
      // re-check of the assembled artifact rather than a re-trust of it.
      const distinctSlots = new Set(group.map((a) => a.slotKey));
      if (distinctSlots.size <= 1) continue;
      for (const assignment of group) {
        diagnostics.push(
          makeDraftDiagnostic("DRAFT_SAME_DAY_PHARMACY_CONFLICT", assignment.date, assignment.assignmentKey)
        );
      }
    }
  }

  return diagnostics;
}
