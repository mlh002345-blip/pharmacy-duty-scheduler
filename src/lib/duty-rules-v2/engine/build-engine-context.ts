// Duty Rules V2 engine — the pure orchestrator.
//
// buildDutyEngineContext composes the stages IN ORDER and contains no
// stage logic of its own. It performs zero I/O and zero writes: no
// Prisma, no loader import (the caller supplies LoadedDutyPlanVersion),
// no clock, no randomness. Errors are controlled DutyEngineError values;
// diagnostics aggregate deterministically.

import { analyzeRuleConflicts } from "../rules/analyze-rule-conflicts";
import { buildRuleEvaluationContext } from "../rules/build-rule-context";
import { buildRuleExplanations, type RuleExplanation } from "../rules/build-rule-explanation";
import { canonicalizeRuleSet, ruleSetFingerprint } from "../rules/canonicalize-rule-set";
import { evaluateRulesForSlot } from "../rules/evaluate-rules";
import { RuleEngineError } from "../rules/rule-errors";
import type { ConfiguredRuleDefinition } from "../rules/domain/rule-definition";
import type { RuleConflict } from "../rules/domain/rule-conflict";
import type { RuleEvaluationResult } from "../rules/domain/rule-evaluation";
import type { ConstraintResult } from "./domain/constraint";
import { applyEligibilityRelaxation, DEFAULT_RELAXABLE_REASONS } from "./apply-eligibility-relaxation";
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

  // Phase 5: validate and conflict-gate the configured rule set BEFORE
  // any evaluation. ERROR conflicts reject the whole run; WARNING/INFO
  // conflicts are reported in the draft result. An empty rule set leaves
  // Phase 4 behavior byte-identical (aside from the constant empty-set
  // fingerprint in provenance).
  const configuredRules: ConfiguredRuleDefinition[] = input.configuredRules ?? [];
  const definitionsById = new Map(configuredRules.map((rule) => [rule.id, rule]));
  let ruleConflicts: RuleConflict[] = [];
  if (configuredRules.length > 0) {
    ruleConflicts = analyzeRuleConflicts(configuredRules, {
      organizationId: plan.organizationId,
      regionId: plan.regionId,
      knownPharmacyIds: new Set(
        plan.rotationPools.flatMap((pool) => pool.memberships.map((m) => m.pharmacyId))
      ),
      knownPoolIds: new Set(plan.rotationPools.map((pool) => pool.id)),
    });
    const errors = ruleConflicts.filter((conflict) => conflict.level === "ERROR");
    if (errors.length > 0) {
      throw new RuleEngineError(
        "RULE_SET_CONFLICTS",
        "Kural kümesi çelişkiler içeriyor.",
        errors.map((conflict) => `${conflict.code}:${conflict.ruleIds.join(",")}`)
      );
    }
    // Canonicalization is also the cheap structural sanity pass.
    canonicalizeRuleSet(configuredRules);
  }
  const rulesFingerprint = ruleSetFingerprint(configuredRules);
  const allRuleResults: RuleEvaluationResult[] = [];

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

      const shift = shifts.shifts.find((s) => s.shiftId === slot.shiftId) ?? null;
      const candidates = resolveCandidates(slot, pool, facts);
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

      // Phase 5: evaluate configured rules over the slot's contexts.
      let ruleResults: RuleEvaluationResult[] = [];
      if (configuredRules.length > 0) {
        const contextBase = {
          plan,
          generationMode: input.generationMode,
          periodStart: input.periodStart,
          periodEnd: input.periodEnd,
          calendar: dayContext,
          dayType,
          slot,
          shift,
          holidayDates,
        };
        ruleResults = evaluateRulesForSlot({
          definitions: configuredRules,
          slotContext: buildRuleEvaluationContext({
            ...contextBase,
            candidate: null,
            fairness: null,
            rotation: null,
          }),
          candidateContexts: candidates.map((candidate, index) =>
            buildRuleEvaluationContext({
              ...contextBase,
              candidate,
              fairness: fairnessFacts[index],
              rotation: rotationFacts[index],
            })
          ),
        });
        allRuleResults.push(...ruleResults);
      }

      // Normalize rule outcomes into the Phase 4 constraint contract:
      // HARD failures exclude, SOFT failures flow into softConcerns,
      // ADVISORY results never touch constraints.
      const ruleConstraintsByCandidate = new Map<string, ConstraintResult[]>();
      for (const result of ruleResults) {
        if (result.candidateKey === null || result.outcome !== "FAIL") continue;
        if (result.severity === "ADVISORY") continue;
        const list = ruleConstraintsByCandidate.get(result.candidateKey) ?? [];
        list.push({
          constraintCode: "CONFIGURED_RULE",
          severity: result.severity,
          candidateKey: result.candidateKey,
          date: result.date,
          slotKey: result.slotKey,
          passed: false,
          observedValue: result.observedValue,
          expectedValue: result.expectedValue,
          explanationCode: result.violationCode ?? result.explanationCode,
        });
        ruleConstraintsByCandidate.set(result.candidateKey, list);
      }

      const eligibility = candidates.map((candidate) =>
        evaluateEligibility(candidate, [
          ...evaluateConstraints(candidate, input.policy),
          ...(ruleConstraintsByCandidate.get(candidate.candidateKey) ?? []),
        ])
      );

      // Relaxation stays V1-limited: the built-in interval reason plus
      // violation codes of rules that BOTH the catalogue and the chamber
      // configuration declare relaxable.
      const relaxableReasonCodes = [
        ...DEFAULT_RELAXABLE_REASONS,
        ...new Set(
          ruleResults
            .filter((r) => r.outcome === "FAIL" && r.severity === "HARD" && r.relaxable)
            .map((r) => r.violationCode ?? r.explanationCode)
        ),
      ];
      const relaxation = applyEligibilityRelaxation({
        slotKey: slot.slotKey,
        date: slot.date,
        requiredCount: slot.requiredCount,
        eligibilityResults: eligibility,
        relaxMinIntervalWhenInsufficient: input.policy.relaxMinIntervalWhenInsufficient,
        relaxableReasonCodes,
      });
      diagnostics.push(...relaxation.diagnostics);

      selectionInputs.push(
        buildSelectionInput({
          slot,
          pool,
          candidates,
          eligibility,
          relaxation,
          fairnessFacts,
          rotationFacts,
          ruleEvaluations: ruleResults,
          diagnostics: [...pool.diagnostics, ...relaxation.diagnostics],
          configurationFingerprint: plan.configurationFingerprint,
          runtimeInputHash: inputHash,
          ruleSetFingerprint: rulesFingerprint,
          loaderVersion: plan.loaderVersion,
          engineVersion: ENGINE_DOMAIN_VERSION,
        })
      );
    }
  }

  selectionInputs.sort((a, b) =>
    a.slot.slotKey < b.slot.slotKey ? -1 : a.slot.slotKey > b.slot.slotKey ? 1 : 0
  );

  const ruleExplanations: RuleExplanation[] =
    configuredRules.length > 0 ? buildRuleExplanations(definitionsById, allRuleResults) : [];

  return buildDraftResult({
    engineVersion: ENGINE_DOMAIN_VERSION,
    generationMode: input.generationMode,
    periodStart: input.periodStart,
    periodEnd: input.periodEnd,
    provenance: {
      configurationFingerprint: plan.configurationFingerprint,
      runtimeInputHash: inputHash,
      ruleSetFingerprint: rulesFingerprint,
      loaderVersion: plan.loaderVersion,
      engineVersion: ENGINE_DOMAIN_VERSION,
      planVersionId: plan.planVersionId,
      organizationId: plan.organizationId,
      regionId: plan.regionId,
    },
    days,
    selectionInputs,
    diagnostics,
    ruleConflicts,
    ruleExplanations,
  });
}
