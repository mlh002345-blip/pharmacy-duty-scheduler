// Duty Rules V2 — Phase 5: RuleEvaluationContext assembly from Phase 4
// stage outputs. Pure projection — no decisions, no defaults.

import type { LoadedDutyPlanVersion } from "../domain/loaded-plan";
import type { CalendarDayContext } from "../engine/resolve-calendar-context";
import type { ResolvedDayType } from "../engine/resolve-day-type";
import type { ResolvedSlot } from "../engine/resolve-slots";
import type { ResolvedShift } from "../engine/resolve-shifts";
import type { SlotCandidate } from "../engine/resolve-candidates";
import type { CandidateFairnessFacts } from "../engine/calculate-fairness-facts";
import type { CandidateRotationFacts } from "../engine/resolve-rotation-facts";
import type { RuleEvaluationContext } from "./domain/rule-evaluation";
import type { RuleHolidayType } from "./domain/rule-scope";

export function buildRuleEvaluationContext(input: {
  plan: LoadedDutyPlanVersion;
  generationMode: "PREVIEW" | "SIMULATION";
  periodStart: string;
  periodEnd: string;
  calendar: CalendarDayContext;
  dayType: ResolvedDayType;
  slot: ResolvedSlot;
  shift: ResolvedShift | null;
  holidayDates: ReadonlySet<string>;
  candidate: SlotCandidate | null;
  fairness: CandidateFairnessFacts | null;
  rotation: CandidateRotationFacts | null;
}): RuleEvaluationContext {
  const holidayTypes: RuleHolidayType[] =
    input.calendar.holidays.length === 0
      ? ["NONE"]
      : [...new Set(input.calendar.holidays.map((holiday) => holiday.type))].sort();

  return {
    organizationId: input.plan.organizationId,
    regionId: input.plan.regionId,
    planId: input.plan.planId,
    planVersionId: input.plan.planVersionId,
    generationMode: input.generationMode,
    periodStart: input.periodStart,
    periodEnd: input.periodEnd,
    date: input.slot.date,
    weekday: input.calendar.weekdayName,
    holidayTypes,
    holidayDates: input.holidayDates,
    dayType: input.dayType.dayType ?? "",
    customDayCategory: input.dayType.customDayCategory,
    dayTypeKey: input.slot.dayTypeKey,
    slot: input.slot,
    poolId: input.slot.poolId,
    shiftKey: input.slot.shiftKey,
    shiftStartMinute: input.shift?.startMinute ?? null,
    shiftEndMinute: input.shift?.endMinute ?? null,
    candidate: input.candidate,
    fairness: input.fairness,
    rotation: input.rotation,
    tags: null,
    groups: null,
    serviceAreas: null,
  };
}
