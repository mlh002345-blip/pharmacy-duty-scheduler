// Duty Rules V2 engine — the pure orchestrator.
//
// buildDutyEngineContext composes the stages IN ORDER and contains no
// stage logic of its own. It performs zero I/O and zero writes: no
// Prisma, no loader import (the caller supplies LoadedDutyPlanVersion),
// no clock, no randomness. Errors are controlled DutyEngineError values;
// diagnostics aggregate deterministically.

import { applyEligibilityRelaxation } from "./apply-eligibility-relaxation";
import { buildDraftResult, type DutyEngineDraftResult, type EngineDayResult } from "./build-draft-result";
import { buildSelectionInput, sha256Canonical, type SelectionInput } from "./build-selection-input";
import { calculateFairnessFacts } from "./calculate-fairness-facts";
import { evaluateConstraints } from "./evaluate-constraints";
import { evaluateEligibility } from "./evaluate-eligibility";
import { resolveCalendarContext } from "./resolve-calendar-context";
import { indexRuntimeFacts, resolveCandidates } from "./resolve-candidates";
import { resolveDayType } from "./resolve-day-type";
import { resolvePool } from "./resolve-pool";
import { resolveRotationFacts } from "./resolve-rotation-facts";
import { resolveShifts } from "./resolve-shifts";
import { resolveSlots } from "./resolve-slots";
import { validateEngineInput, type DutyEngineInput } from "./domain/engine-input";
import type { EngineDiagnostic } from "./domain/diagnostics";

export const ENGINE_DOMAIN_VERSION = 1;

/** Canonical hash of everything runtime-supplied (the loaded plan is
 *  covered separately by its configuration fingerprint). */
export function runtimeInputHash(input: DutyEngineInput): string {
  return sha256Canonical({
    periodStart: input.periodStart,
    periodEnd: input.periodEnd,
    generationMode: input.generationMode,
    policy: input.policy,
    holidays: sortPlain(input.holidays),
    customDayOverrides: sortPlain(input.customDayOverrides),
    unavailability: sortPlain(input.unavailability),
    dutyRequests: sortPlain(input.dutyRequests),
    historicalDuties: sortPlain(input.historicalDuties),
    balanceAdjustments: sortPlain(input.balanceAdjustments),
    existingAssignments: sortPlain(input.existingAssignments),
  });
}

/** Order-insensitive canonicalization of a runtime record array. */
function sortPlain<T>(items: T[]): T[] {
  return [...items].sort((a, b) => {
    const ka = JSON.stringify(a, Object.keys(a as object).sort());
    const kb = JSON.stringify(b, Object.keys(b as object).sort());
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  });
}

export function buildDutyEngineContext(input: DutyEngineInput): DutyEngineDraftResult {
  validateEngineInput(input);

  const plan = input.loadedPlan;
  const facts = indexRuntimeFacts(input);
  const inputHash = runtimeInputHash(input);
  const holidayDates: ReadonlySet<string> = new Set(input.holidays.map((h) => h.date));

  const calendar = resolveCalendarContext(input);

  const days: EngineDayResult[] = [];
  const selectionInputs: SelectionInput[] = [];
  const diagnostics: EngineDiagnostic[] = [];

  for (const dayContext of calendar) {
    const dayType = resolveDayType(dayContext, plan.dayTypeRules);
    diagnostics.push(...dayType.diagnostics);

    const shifts = resolveShifts(dayType, plan);
    diagnostics.push(...shifts.diagnostics);

    const slots = resolveSlots(dayType, shifts.shifts, plan);
    diagnostics.push(...slots.diagnostics);

    days.push({
      date: dayContext.date,
      calendar: dayContext,
      dayType,
      shifts: shifts.shifts,
      slots: slots.slots,
    });

    for (const slot of slots.slots) {
      const pool = resolvePool(slot, plan);
      if (pool === null) continue; // SLOT_WITHOUT_POOL already diagnosed.
      diagnostics.push(...pool.diagnostics);

      const shift = shifts.shifts.find((s) => s.shiftId === slot.shiftId);
      const candidates = resolveCandidates(slot, pool, facts);
      const constraintsByCandidate = candidates.map((candidate) =>
        evaluateConstraints(candidate, input.policy)
      );
      const eligibility = candidates.map((candidate, index) =>
        evaluateEligibility(candidate, constraintsByCandidate[index])
      );
      const relaxation = applyEligibilityRelaxation({
        slotKey: slot.slotKey,
        date: slot.date,
        requiredCount: slot.requiredCount,
        eligibilityResults: eligibility,
        relaxMinIntervalWhenInsufficient: input.policy.relaxMinIntervalWhenInsufficient,
      });
      diagnostics.push(...relaxation.diagnostics);

      const fairnessFacts = candidates.map((candidate) =>
        calculateFairnessFacts({
          candidate,
          dayTypeKey: slot.dayTypeKey,
          shift: { defaultWeight: shift?.defaultWeight ?? 1 },
          policy: input.policy,
          holidayDates,
        })
      );
      const rotationFacts = candidates.map((candidate) =>
        resolveRotationFacts(candidate, pool, slot.dayTypeKey)
      );

      selectionInputs.push(
        buildSelectionInput({
          slot,
          pool,
          candidates,
          eligibility,
          relaxation,
          fairnessFacts,
          rotationFacts,
          diagnostics: [...pool.diagnostics, ...relaxation.diagnostics],
          configurationFingerprint: plan.configurationFingerprint,
          runtimeInputHash: inputHash,
          loaderVersion: plan.loaderVersion,
          engineVersion: ENGINE_DOMAIN_VERSION,
        })
      );
    }
  }

  selectionInputs.sort((a, b) =>
    a.slot.slotKey < b.slot.slotKey ? -1 : a.slot.slotKey > b.slot.slotKey ? 1 : 0
  );

  return buildDraftResult({
    engineVersion: ENGINE_DOMAIN_VERSION,
    generationMode: input.generationMode,
    periodStart: input.periodStart,
    periodEnd: input.periodEnd,
    provenance: {
      configurationFingerprint: plan.configurationFingerprint,
      runtimeInputHash: inputHash,
      loaderVersion: plan.loaderVersion,
      engineVersion: ENGINE_DOMAIN_VERSION,
      planVersionId: plan.planVersionId,
      organizationId: plan.organizationId,
      regionId: plan.regionId,
    },
    days,
    selectionInputs,
    diagnostics,
  });
}
