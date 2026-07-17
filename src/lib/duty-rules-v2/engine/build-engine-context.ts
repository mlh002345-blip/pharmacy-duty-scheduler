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
import { analyzeStrategyConflicts } from "../selection/analyze-strategy-conflicts";
import { strategySetFingerprint } from "../selection/canonicalize-strategy-set";
import { getStrategyCatalogueEntry } from "../selection/catalogue";
import { buildSelectionExplanations, type SelectionExplanation } from "../selection/build-selection-explanations";
import { selectProvisionalWinnersSequential } from "../selection/apply-sequential-selection-state";
import { SelectionEngineError } from "../selection/strategy-errors";
import type { ConfiguredSelectionStrategy } from "../selection/domain/strategy-definition";
import type { StrategyConflict } from "../selection/domain/strategy-conflict";
import type { ProvisionalSlotSelection } from "../selection/domain/selection-result";
import type { StrategyMatchContext } from "../selection/domain/strategy-context";
import { applyEligibilityRelaxation, DEFAULT_RELAXABLE_REASONS } from "./apply-eligibility-relaxation";
import { buildDraftResult, type DutyEngineDraftResult, type EngineDayResult } from "./build-draft-result";
import { assembleCompleteDraftSchedule } from "../draft/build-complete-draft-schedule";
import { buildSelectionInput, sha256Canonical, type SelectionInput } from "./build-selection-input";
import { calculateFairnessFacts } from "./calculate-fairness-facts";
import { evaluateConstraints } from "./evaluate-constraints";
import { evaluateEligibility } from "./evaluate-eligibility";
import { resolveCalendarContext, resolveCompatibilityLastInputHoliday } from "./resolve-calendar-context";
import { indexRuntimeFacts, resolveCandidates } from "./resolve-candidates";
import { resolveDayType } from "./resolve-day-type";
import { resolvePool } from "./resolve-pool";
import { resolveRotationFacts } from "./resolve-rotation-facts";
import { resolveShifts } from "./resolve-shifts";
import { resolveSlots } from "./resolve-slots";
import { validateEngineInput, type DutyEngineInput } from "./domain/engine-input";
import type { EngineDiagnostic } from "./domain/diagnostics";

export const ENGINE_DOMAIN_VERSION = 1;
// Bumped for the sequential-relaxation-contract corrective: this is a
// genuine behavior change (a previously-invisible-to-sequential-
// relaxation candidate can now be admitted), so any affected run's
// provisionalSelectionFingerprint/resultFingerprint changes — expected,
// version-bumped for provenance honesty, never silently absorbed.
export const SELECTION_ENGINE_VERSION = 2;

/** Canonical hash of everything runtime-supplied (the loaded plan is
 *  covered separately by its configuration fingerprint). */
export function runtimeInputHash(input: DutyEngineInput): string {
  return sha256Canonical({
    periodStart: input.periodStart,
    periodEnd: input.periodEnd,
    generationMode: input.generationMode,
    policy: input.policy,
    holidays: sortPlain(input.holidays),
    // Phase 6 corrective: holidays' ORIGINAL array order only
    // participates in the hash when V1_LAST_INPUT_WINS compatibility
    // mode is active — that is the only mode whose behavior can depend
    // on it (native mode's day-type precedence is order-independent by
    // construction, so its hash — and therefore every downstream
    // fingerprint and selection — stays byte-identical under reordering,
    // exactly as before this corrective).
    holidayInputOrder:
      input.policy.holidayOverlapResolutionMode === "V1_LAST_INPUT_WINS" ? input.holidays : null,
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

  // Phase 6: validate and conflict-gate the configured selection-strategy
  // set BEFORE any ranking — same ERROR-abort / WARNING-report split as
  // rules above. An empty strategy set produces no provisional selections
  // (Phase 4/5 behavior otherwise unchanged, aside from the constant
  // empty-set fingerprint in provenance).
  const configuredStrategies: ConfiguredSelectionStrategy[] = input.configuredSelectionStrategies ?? [];
  const strategyDefinitionsById = new Map(configuredStrategies.map((s) => [s.id, s]));
  let strategyConflicts: StrategyConflict[] = [];
  if (configuredStrategies.length > 0) {
    strategyConflicts = analyzeStrategyConflicts(configuredStrategies, {
      organizationId: plan.organizationId,
      regionId: plan.regionId,
    });
    const strategyErrors = strategyConflicts.filter((conflict) => conflict.level === "ERROR");
    if (strategyErrors.length > 0) {
      throw new SelectionEngineError(
        "STRATEGY_SET_CONFLICTS",
        "Seçim stratejisi kümesi çelişkiler içeriyor.",
        strategyErrors.map((conflict) => `${conflict.code}:${conflict.strategyIds.join(",")}`)
      );
    }
  }
  const strategiesFingerprint = strategySetFingerprint(configuredStrategies, (strategyType) => {
    return getStrategyCatalogueEntry(strategyType)?.comparatorVersion ?? 0;
  });
  const provisionalSelections: ProvisionalSlotSelection[] = [];
  const selectionExplanations: SelectionExplanation[] = [];
  const pendingSelectionSlots: Parameters<typeof selectProvisionalWinnersSequential>[0]["slots"] = [];

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
      // Phase 6 corrective: explicit holiday-eve weight source. Native V2
      // semantics (default) weight HOLIDAY_EVE by its own configured
      // dayTypeWeights entry. In V1 compatibility mode
      // (holidayEveWeightSource === "UNDERLYING_WEEKDAY"), an eve date is
      // weighted by whatever its ACTUAL calendar weekday is — V1 has no
      // eve concept at all (generate-duty-schedule.ts's resolveDutyWeight
      // only ever branches on holiday/Saturday/Sunday/weekday), so this
      // is the only way to reproduce V1's weight byte-for-byte on eve
      // dates. Every other resolved day type is unaffected.
      // Phase 6 corrective (Part 4): explicit holiday-overlap resolution
      // mode. Native precedence (default) always prefers
      // RELIGIOUS_HOLIDAY over OFFICIAL_HOLIDAY for weight purposes,
      // deterministically, regardless of input order — untouched here.
      // V1_LAST_INPUT_WINS instead uses whichever holiday record was
      // LAST in the caller's original array for this date (V1's actual,
      // order-dependent Map-overwrite behavior; OTHER maps to the
      // OFFICIAL_HOLIDAY weight bucket, matching V1's own rule).
      const lastInputHoliday =
        input.policy.holidayOverlapResolutionMode === "V1_LAST_INPUT_WINS"
          ? resolveCompatibilityLastInputHoliday(input.holidays, dayContext.date)
          : null;
      const overlapWeightDayType =
        lastInputHoliday !== null
          ? lastInputHoliday.type === "RELIGIOUS"
            ? "RELIGIOUS_HOLIDAY"
            : "OFFICIAL_HOLIDAY"
          : null;
      const weightDayTypeKey =
        overlapWeightDayType ??
        (input.policy.holidayEveWeightSource === "UNDERLYING_WEEKDAY" &&
        dayType.dayType === "HOLIDAY_EVE"
          ? dayContext.compatibilityWeightDayType
          : slot.dayTypeKey);
      const fairnessFacts = candidates.map((candidate) =>
        calculateFairnessFacts({
          candidate,
          dayTypeKey: weightDayTypeKey,
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

      const selectionInput = buildSelectionInput({
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
        strategySetFingerprint: strategiesFingerprint,
        loaderVersion: plan.loaderVersion,
        engineVersion: ENGINE_DOMAIN_VERSION,
        relaxableReasonCodes,
      });
      selectionInputs.push(selectionInput);

      // Phase 6 corrective: collected here (in chronological loop order)
      // rather than selected immediately — provisional selection now
      // runs as ONE sequential pass over the whole period below, so that
      // an earlier date's provisional winner affects a later date's
      // fairness facts and MIN_DAYS_BETWEEN_DUTIES eligibility exactly
      // as V1's single-loop `metrics` mutation does. See
      // apply-sequential-selection-state.ts for the root-cause
      // explanation and the pure, in-memory accumulator design.
      if (configuredStrategies.length > 0) {
        const holidayTypesForDay: StrategyMatchContext["holidayTypes"] =
          dayContext.holidays.length === 0
            ? ["NONE"]
            : [...new Set(dayContext.holidays.map((h) => h.type))].sort();
        pendingSelectionSlots.push({
          selectionInput,
          matchContextBase: {
            organizationId: plan.organizationId,
            regionId: plan.regionId,
            planId: plan.planId,
            planVersionId: plan.planVersionId,
            generationMode: input.generationMode,
            date: slot.date,
            weekday: dayContext.weekdayName,
            holidayTypes: holidayTypesForDay,
            dayType: dayType.dayType ?? "",
            customDayCategory: dayType.customDayCategory,
          },
          isWeekendDate: dayContext.isSaturday || dayContext.isSunday,
          isSundayDate: dayContext.isSunday,
          isHolidayDate: dayContext.holidays.length > 0,
        });
      }
    }
  }

  selectionInputs.sort((a, b) =>
    a.slot.slotKey < b.slot.slotKey ? -1 : a.slot.slotKey > b.slot.slotKey ? 1 : 0
  );

  if (configuredStrategies.length > 0) {
    // selectProvisionalWinnersSequential normalizes chronological order
    // internally (Phase 6 corrective, Part 3) — no pre-sort needed here.
    const sequentialResults = selectProvisionalWinnersSequential({
      slots: pendingSelectionSlots,
      minDaysBetweenDuties: input.policy.minDaysBetweenDuties,
      sameDaySecondAssignmentAllowed: input.policy.sameDaySecondAssignmentAllowed,
      relaxMinIntervalWhenInsufficient: input.policy.relaxMinIntervalWhenInsufficient,
      definitions: configuredStrategies,
      definitionsById: strategyDefinitionsById,
    });
    provisionalSelections.push(...sequentialResults);
    for (const slotSelection of sequentialResults) {
      selectionExplanations.push(...buildSelectionExplanations(slotSelection));
    }
  }

  provisionalSelections.sort((a, b) => (a.slotKey < b.slotKey ? -1 : a.slotKey > b.slotKey ? 1 : 0));
  selectionExplanations.sort((a, b) =>
    a.candidateKey < b.candidateKey ? -1 : a.candidateKey > b.candidateKey ? 1 : 0
  );

  const ruleExplanations: RuleExplanation[] =
    configuredRules.length > 0 ? buildRuleExplanations(definitionsById, allRuleResults) : [];

  const preDraftResult = buildDraftResult({
    engineVersion: ENGINE_DOMAIN_VERSION,
    generationMode: input.generationMode,
    periodStart: input.periodStart,
    periodEnd: input.periodEnd,
    provenance: {
      configurationFingerprint: plan.configurationFingerprint,
      runtimeInputHash: inputHash,
      ruleSetFingerprint: rulesFingerprint,
      strategySetFingerprint: strategiesFingerprint,
      selectionEngineVersion: SELECTION_ENGINE_VERSION,
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
    provisionalSelections,
    strategyConflicts,
    selectionExplanations,
  });

  // Phase 7: additive assembly of the Complete Draft Schedule from the
  // Phase 4-6 result above. Orchestration only — no assembly/validation
  // logic lives in this function; see build-complete-draft-schedule.ts.
  const completeDraftSchedule = assembleCompleteDraftSchedule(preDraftResult, {
    sameDaySecondAssignmentAllowed: input.policy.sameDaySecondAssignmentAllowed,
  });

  return {
    ...preDraftResult,
    completeDraftSchedule,
    completeDraftFingerprint: completeDraftSchedule.completeDraftFingerprint,
    draftManifest: completeDraftSchedule.manifest,
  };
}
