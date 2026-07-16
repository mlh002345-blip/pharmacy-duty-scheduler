// Duty Rules V2 engine — Stage 3: shift resolver.
//
// Returns every shift relevant to the resolved day type (the shifts its
// slot requirements reference), in the plan's canonical deterministic
// order. No fabricated times: null start/end (the synthetic V1 shift)
// pass through untouched; overnight shifts keep spansMidnight verbatim.
// Never assumes one shift per date.

import type { LoadedDutyPlanVersion, LoadedShiftDefinition } from "../domain/loaded-plan";
import type { EngineDiagnostic } from "./domain/diagnostics";
import type { ResolvedDayType } from "./resolve-day-type";

export type ResolvedShift = {
  shiftId: string;
  /** The shift's stable human key: its name (unique per plan version). */
  shiftKey: string;
  startMinute: number | null;
  endMinute: number | null;
  spansMidnight: boolean | null;
  defaultWeight: number;
  sortOrder: number;
};

export type ResolveShiftsResult = {
  date: string;
  shifts: ResolvedShift[];
  diagnostics: EngineDiagnostic[];
};

export function resolveShifts(
  dayType: ResolvedDayType,
  plan: LoadedDutyPlanVersion
): ResolveShiftsResult {
  const diagnostics: EngineDiagnostic[] = [];
  if (!dayType.resolved || dayType.dayTypeRuleId === null) {
    return { date: dayType.date, shifts: [], diagnostics };
  }

  const shiftById = new Map(plan.shiftDefinitions.map((shift) => [shift.id, shift]));
  const referencedIds = new Set(
    plan.slotRequirements
      .filter((slot) => slot.dayTypeRuleId === dayType.dayTypeRuleId)
      .map((slot) => slot.shiftDefinitionId)
  );

  const shifts: ResolvedShift[] = [];
  const seenKeys = new Set<string>();
  for (const shiftId of referencedIds) {
    const shift = shiftById.get(shiftId);
    if (!shift) {
      // The loader rejects cross-version references; defensive only.
      diagnostics.push({
        code: "SLOT_WITHOUT_SHIFT",
        date: dayType.date,
        subjectKey: shiftId,
      });
      continue;
    }
    if (seenKeys.has(shift.name)) {
      // Duplicate shift semantics are ambiguous — loader-rejected;
      // re-asserted so hand-built plans cannot smuggle them through.
      diagnostics.push({
        code: "SLOT_WITHOUT_SHIFT",
        date: dayType.date,
        subjectKey: shift.id,
      });
      continue;
    }
    seenKeys.add(shift.name);
    shifts.push(toResolvedShift(shift));
  }

  shifts.sort(
    (a, b) =>
      a.sortOrder - b.sortOrder ||
      (a.shiftKey < b.shiftKey ? -1 : a.shiftKey > b.shiftKey ? 1 : 0) ||
      (a.shiftId < b.shiftId ? -1 : a.shiftId > b.shiftId ? 1 : 0)
  );
  return { date: dayType.date, shifts, diagnostics };
}

function toResolvedShift(shift: LoadedShiftDefinition): ResolvedShift {
  // The Phase 1 schema persists startMinute/endMinute as required Ints;
  // the V1-adapted synthetic shift carries no time semantics. The
  // convention (see the V1 adapter) is startMinute === endMinute === 0
  // with spansMidnight false for "no time semantics" when such a plan is
  // materialized — the engine NEVER fabricates hours, so a 0/0 pair is
  // surfaced as null/null (whole-day duty), preserving V1 honesty.
  const hasTimes = !(shift.startMinute === 0 && shift.endMinute === 0 && !shift.spansMidnight);
  return {
    shiftId: shift.id,
    shiftKey: shift.name,
    startMinute: hasTimes ? shift.startMinute : null,
    endMinute: hasTimes ? shift.endMinute : null,
    spansMidnight: hasTimes ? shift.spansMidnight : null,
    defaultWeight: shift.defaultWeight,
    sortOrder: shift.sortOrder,
  };
}
