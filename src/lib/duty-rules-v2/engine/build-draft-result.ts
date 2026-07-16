// Duty Rules V2 engine — Stage 12: draft result builder.
//
// The inspectable, WRITE-NOTHING output of the engine-domain pipeline: a
// complete description of what a future selection engine would work
// with, plus explicit unresolved/underfilled slots. It contains NO
// committed DutySchedule/DutyAssignment models and may be incomplete —
// incompleteness is explicit, never hidden.
//
// resultFingerprint = sha256 over the canonical serialization of the
// entire result (minus the fingerprint field itself). Because every
// component is deterministically ordered and derived only from explicit
// input, byte-identical inputs always produce byte-identical results.

import type { EngineGenerationMode } from "./domain/engine-input";
import { sortDiagnostics, type EngineDiagnostic } from "./domain/diagnostics";
import { sha256Canonical } from "./build-selection-input";
import type { SelectionInput } from "./build-selection-input";
import type { CalendarDayContext } from "./resolve-calendar-context";
import type { ResolvedDayType } from "./resolve-day-type";
import type { ResolvedShift } from "./resolve-shifts";
import type { ResolvedSlot } from "./resolve-slots";

export type UnresolvedSlot = {
  slotKey: string;
  date: string;
  /** Stable cause: SLOT_WITHOUT_POOL, INSUFFICIENT_STRICT_CANDIDATES →
   *  see the diagnostics catalogue. */
  reasonCode: string;
};

export type EngineDayResult = {
  date: string;
  calendar: CalendarDayContext;
  dayType: ResolvedDayType;
  shifts: ResolvedShift[];
  slots: ResolvedSlot[];
};

export type EngineRunProvenance = {
  configurationFingerprint: string;
  runtimeInputHash: string;
  loaderVersion: number;
  engineVersion: number;
  planVersionId: string;
  organizationId: string;
  regionId: string;
};

export type DutyEngineDraftResult = {
  engineVersion: number;
  generationMode: EngineGenerationMode;
  periodStart: string;
  periodEnd: string;
  provenance: EngineRunProvenance;
  days: EngineDayResult[];
  selectionInputs: SelectionInput[];
  counts: {
    dates: number;
    resolvedDates: number;
    servedDates: number;
    slots: number;
    resolvableSlots: number;
    candidates: number;
    strictEligible: number;
    relaxedEligible: number;
  };
  unresolvedSlots: UnresolvedSlot[];
  warnings: EngineDiagnostic[];
  resultFingerprint: string;
};

export function buildDraftResult(input: {
  engineVersion: number;
  generationMode: EngineGenerationMode;
  periodStart: string;
  periodEnd: string;
  provenance: EngineRunProvenance;
  days: EngineDayResult[];
  selectionInputs: SelectionInput[];
  diagnostics: EngineDiagnostic[];
}): DutyEngineDraftResult {
  const unresolvedSlots: UnresolvedSlot[] = [];
  for (const day of input.days) {
    for (const slot of day.slots) {
      if (!slot.resolvable) {
        unresolvedSlots.push({ slotKey: slot.slotKey, date: slot.date, reasonCode: "SLOT_WITHOUT_POOL" });
      }
    }
  }
  for (const selection of input.selectionInputs) {
    const filled =
      selection.relaxation.strictEligible.length + selection.relaxation.relaxedEligible.length;
    if (filled < selection.requiredCount) {
      unresolvedSlots.push({
        slotKey: selection.slot.slotKey,
        date: selection.slot.date,
        reasonCode: "INSUFFICIENT_CANDIDATES_AFTER_RELAXATION",
      });
    }
  }
  unresolvedSlots.sort((a, b) => (a.slotKey < b.slotKey ? -1 : a.slotKey > b.slotKey ? 1 : 0));

  const unresolvedDiagnostics: EngineDiagnostic[] = unresolvedSlots.map((slot) => ({
    code: "UNRESOLVED_SLOT",
    date: slot.date,
    subjectKey: slot.slotKey,
  }));

  const withoutFingerprint = {
    engineVersion: input.engineVersion,
    generationMode: input.generationMode,
    periodStart: input.periodStart,
    periodEnd: input.periodEnd,
    provenance: input.provenance,
    days: input.days,
    selectionInputs: input.selectionInputs,
    counts: {
      dates: input.days.length,
      resolvedDates: input.days.filter((day) => day.dayType.resolved).length,
      servedDates: input.days.filter((day) => day.dayType.served === true).length,
      slots: input.days.reduce((sum, day) => sum + day.slots.length, 0),
      resolvableSlots: input.days.reduce(
        (sum, day) => sum + day.slots.filter((slot) => slot.resolvable).length,
        0
      ),
      candidates: input.selectionInputs.reduce((sum, s) => sum + s.candidates.length, 0),
      strictEligible: input.selectionInputs.reduce(
        (sum, s) => sum + s.relaxation.strictEligible.length,
        0
      ),
      relaxedEligible: input.selectionInputs.reduce(
        (sum, s) => sum + s.relaxation.relaxedEligible.length,
        0
      ),
    },
    unresolvedSlots,
    warnings: sortDiagnostics([...input.diagnostics, ...unresolvedDiagnostics]),
  };

  return { ...withoutFingerprint, resultFingerprint: sha256Canonical(withoutFingerprint) };
}
