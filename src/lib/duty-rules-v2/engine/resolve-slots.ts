// Duty Rules V2 engine — Stage 4: slot resolver.
//
// Expands the resolved day type's slot requirements into per-date active
// slots. Slots are never collapsed or merged; multiple slots per shift
// and requiredCount > 1 pass through verbatim; a null pool reference is
// an EXPLICIT unresolved configuration (diagnostic + unresolved slot) —
// no default pool is ever invented.

import type { LoadedDutyPlanVersion } from "../domain/loaded-plan";
import type { EngineDiagnostic } from "./domain/diagnostics";
import type { ResolvedDayType } from "./resolve-day-type";
import type { ResolvedShift } from "./resolve-shifts";

export type ResolvedSlot = {
  /** Stable, row-id-independent key:
   *  "{date}:{dayTypeKey}:{shiftKey}:{sortOrder}" — unique because the
   *  loader enforces (rule, shift, sortOrder) uniqueness. */
  slotKey: string;
  date: string;
  dayTypeKey: string;
  dayTypeRuleId: string;
  slotId: string;
  slotName: string | null;
  shiftId: string;
  shiftKey: string;
  requiredCount: number;
  poolId: string | null;
  sortOrder: number;
  /** False when the slot cannot be filled by any engine (no pool). */
  resolvable: boolean;
};

export type ResolveSlotsResult = {
  date: string;
  slots: ResolvedSlot[];
  diagnostics: EngineDiagnostic[];
};

export function resolveSlots(
  dayType: ResolvedDayType,
  shifts: ResolvedShift[],
  plan: LoadedDutyPlanVersion
): ResolveSlotsResult {
  const diagnostics: EngineDiagnostic[] = [];
  if (!dayType.resolved || dayType.dayTypeRuleId === null || dayType.served !== true) {
    // Unresolved or unserved dates carry no active slots; the day-type
    // stage has already emitted the explaining diagnostic.
    return { date: dayType.date, slots: [], diagnostics };
  }

  const shiftByById = new Map(shifts.map((shift) => [shift.shiftId, shift]));
  const slots: ResolvedSlot[] = [];
  for (const slot of plan.slotRequirements) {
    if (slot.dayTypeRuleId !== dayType.dayTypeRuleId) continue;
    const shift = shiftByById.get(slot.shiftDefinitionId);
    if (!shift) {
      diagnostics.push({
        code: "SLOT_WITHOUT_SHIFT",
        date: dayType.date,
        subjectKey: slot.id,
      });
      continue;
    }
    const slotKey = `${dayType.date}:${dayType.dayTypeKey}:${shift.shiftKey}:${slot.sortOrder}`;
    if (slot.requiredCount < 1) {
      // Loader-rejected; defensive for hand-built plans.
      diagnostics.push({ code: "INVALID_REQUIRED_COUNT", date: dayType.date, subjectKey: slotKey });
      continue;
    }
    if (slot.rotationPoolId === null) {
      diagnostics.push({ code: "SLOT_WITHOUT_POOL", date: dayType.date, subjectKey: slotKey });
    }
    slots.push({
      slotKey,
      date: dayType.date,
      dayTypeKey: dayType.dayTypeKey as string,
      dayTypeRuleId: dayType.dayTypeRuleId,
      slotId: slot.id,
      slotName: slot.name,
      shiftId: shift.shiftId,
      shiftKey: shift.shiftKey,
      requiredCount: slot.requiredCount,
      poolId: slot.rotationPoolId,
      sortOrder: slot.sortOrder,
      resolvable: slot.rotationPoolId !== null,
    });
  }

  slots.sort(
    (a, b) =>
      a.sortOrder - b.sortOrder ||
      (a.shiftKey < b.shiftKey ? -1 : a.shiftKey > b.shiftKey ? 1 : 0) ||
      (a.slotId < b.slotId ? -1 : a.slotId > b.slotId ? 1 : 0)
  );
  return { date: dayType.date, slots, diagnostics };
}
