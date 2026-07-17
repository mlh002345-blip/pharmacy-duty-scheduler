// Duty Rules V2 — Phase 6: configured strategy-definition validation.

import { z } from "zod";

import { getStrategyCatalogueEntry, PROHIBITED_STRATEGY_TYPES } from "./catalogue";
import { STRATEGY_SOURCES, type ConfiguredSelectionStrategy } from "./domain/strategy-definition";
import { STRATEGY_SCOPE_DIMENSIONS } from "./domain/strategy-context";
import { TIE_BREAKER_CODES } from "./domain/ranking-fact";
import { safeId, STRATEGY_LIMITS } from "./domain/strategy-parameters";
import { WEEKDAY_NAMES } from "../engine/domain/dates";

export type StrategyDefinitionIssue = {
  code:
    | "INVALID_SHAPE"
    | "RANDOM_STRATEGY_REJECTED"
    | "UNKNOWN_STRATEGY_TYPE"
    | "INVALID_PARAMETERS"
    | "UNSUPPORTED_SCOPE_DIMENSION"
    | "UNSUPPORTED_TIE_BREAKER"
    | "DUPLICATE_TIE_BREAKER"
    | "EXCESSIVE_FALLBACK_CHAIN"
    | "SELF_FALLBACK"
    | "INVALID_VALIDITY_RANGE";
  strategyId: string;
  detail: string;
};

const holidayTypeSchema = z.enum(["OFFICIAL", "RELIGIOUS", "OTHER", "NONE"]);
const generationModeSchema = z.enum(["PREVIEW", "SIMULATION"]);
const weekdaySchema = z.enum(WEEKDAY_NAMES);
const safeDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const scopeSchema = z
  .object({
    organizationId: safeId.optional(),
    regionId: safeId.optional(),
    planId: safeId.optional(),
    planVersionId: safeId.optional(),
    poolIds: z.array(safeId).max(1000).optional(),
    dayTypes: z.array(z.string().min(1).max(200)).max(50).optional(),
    customDayCategories: z.array(z.string().min(1).max(200)).max(50).optional(),
    shiftKeys: z.array(z.string().min(1).max(200)).max(100).optional(),
    slotIds: z.array(safeId).max(1000).optional(),
    generationModes: z.array(generationModeSchema).max(2).optional(),
    dateRange: z.object({ start: safeDate, end: safeDate }).strict().optional(),
    weekdays: z.array(weekdaySchema).max(7).optional(),
    holidayTypes: z.array(holidayTypeSchema).max(4).optional(),
  })
  .strict();

const definitionShapeSchema = z
  .object({
    id: safeId,
    strategyType: z.string().min(1).max(STRATEGY_LIMITS.maxNameLength),
    name: z.string().min(1).max(STRATEGY_LIMITS.maxNameLength),
    enabled: z.boolean(),
    priority: z.number().int().min(0).max(100000),
    scope: scopeSchema,
    parameters: z.record(z.string(), z.unknown()),
    validFrom: safeDate.nullable(),
    validTo: safeDate.nullable(),
    source: z.enum(STRATEGY_SOURCES),
    version: z.number().int().min(1),
    fallbackStrategyIds: z.array(safeId).max(STRATEGY_LIMITS.maxFallbackLevels),
    tieBreakers: z
      .array(z.enum(TIE_BREAKER_CODES))
      .max(STRATEGY_LIMITS.maxTieBreakersPerStrategy),
    metadata: z.object({ description: z.string().max(STRATEGY_LIMITS.maxNameLength).optional() }).strict(),
  })
  .strict();

export function validateStrategyDefinition(
  definition: ConfiguredSelectionStrategy
): StrategyDefinitionIssue[] {
  const issues: StrategyDefinitionIssue[] = [];
  const strategyId =
    typeof definition?.id === "string" && definition.id.length > 0 ? definition.id : "?";

  const shape = definitionShapeSchema.safeParse(definition);
  if (!shape.success) {
    issues.push({
      code: "INVALID_SHAPE",
      strategyId,
      detail: shape.error.issues[0]?.path.join(".") ?? "?",
    });
    return issues;
  }

  if (PROHIBITED_STRATEGY_TYPES.has(definition.strategyType)) {
    issues.push({ code: "RANDOM_STRATEGY_REJECTED", strategyId, detail: definition.strategyType });
    return issues;
  }

  const entry = getStrategyCatalogueEntry(definition.strategyType);
  if (!entry) {
    issues.push({ code: "UNKNOWN_STRATEGY_TYPE", strategyId, detail: definition.strategyType });
    return issues;
  }

  const parameters = entry.parameterSchema.safeParse(definition.parameters);
  if (!parameters.success) {
    issues.push({
      code: "INVALID_PARAMETERS",
      strategyId,
      detail: parameters.error.issues[0]?.path.join(".") || parameters.error.issues[0]?.message || "?",
    });
  }

  for (const dimension of STRATEGY_SCOPE_DIMENSIONS) {
    if (definition.scope[dimension] === undefined) continue;
    if (!entry.supportedScopeDimensions.includes(dimension)) {
      issues.push({ code: "UNSUPPORTED_SCOPE_DIMENSION", strategyId, detail: dimension });
    }
  }

  const seenTieBreakers = new Set<string>();
  for (const tieBreaker of definition.tieBreakers) {
    if (seenTieBreakers.has(tieBreaker)) {
      issues.push({ code: "DUPLICATE_TIE_BREAKER", strategyId, detail: tieBreaker });
    }
    seenTieBreakers.add(tieBreaker);
    if (!entry.supportedTieBreakers.includes(tieBreaker)) {
      issues.push({ code: "UNSUPPORTED_TIE_BREAKER", strategyId, detail: tieBreaker });
    }
  }

  if (definition.fallbackStrategyIds.includes(definition.id)) {
    issues.push({ code: "SELF_FALLBACK", strategyId, detail: definition.id });
  }
  if (definition.fallbackStrategyIds.length > STRATEGY_LIMITS.maxFallbackLevels) {
    issues.push({
      code: "EXCESSIVE_FALLBACK_CHAIN",
      strategyId,
      detail: String(definition.fallbackStrategyIds.length),
    });
  }

  if (
    definition.validFrom !== null &&
    definition.validTo !== null &&
    definition.validFrom > definition.validTo
  ) {
    issues.push({
      code: "INVALID_VALIDITY_RANGE",
      strategyId,
      detail: `${definition.validFrom}>${definition.validTo}`,
    });
  }
  const range = definition.scope.dateRange;
  if (range && range.start > range.end) {
    issues.push({ code: "INVALID_VALIDITY_RANGE", strategyId, detail: `${range.start}>${range.end}` });
  }

  return issues;
}
