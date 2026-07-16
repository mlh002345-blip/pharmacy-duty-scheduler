// Duty Rules V2 — Phase 5: configured-definition validation.
//
// Validates ONE ConfiguredRuleDefinition against the platform catalogue:
// strict shape, known rule type, allowed severity, per-type strict
// parameter schema, supported scope dimensions and exception kinds, and
// safety bounds. Anything executable-looking is rejected by shape alone
// (strict object schemas admit no unknown keys anywhere).

import { z } from "zod";

import { getCatalogueEntry } from "./catalogue";
import { RULE_SEVERITIES, RULE_SOURCES, type ConfiguredRuleDefinition } from "./domain/rule-definition";
import { EXCEPTION_KINDS, SCOPE_DIMENSIONS, UNSUPPORTED_SCOPE_DIMENSIONS } from "./domain/rule-scope";
import { RULE_LIMITS, safeDate, safeDateArray, safeId, safeIdArray } from "./domain/rule-parameters";
import { WEEKDAY_NAMES } from "../engine/domain/dates";

export type RuleDefinitionIssue = {
  code:
    | "INVALID_SHAPE"
    | "UNKNOWN_RULE_TYPE"
    | "UNSUPPORTED_SEVERITY"
    | "SEVERITY_NOT_CONFIGURABLE"
    | "INVALID_PARAMETERS"
    | "UNSUPPORTED_SCOPE_DIMENSION"
    | "UNSUPPORTED_FUTURE_SCOPE_DIMENSION"
    | "UNSUPPORTED_EXCEPTION_KIND"
    | "INVALID_VALIDITY_RANGE";
  ruleId: string;
  detail: string;
};

const holidayTypeSchema = z.enum(["OFFICIAL", "RELIGIOUS", "OTHER", "NONE"]);
const generationModeSchema = z.enum(["PREVIEW", "SIMULATION"]);
const weekdaySchema = z.enum(WEEKDAY_NAMES);

const scopeSchema = z
  .object({
    organizationId: safeId.optional(),
    regionId: safeId.optional(),
    planId: safeId.optional(),
    planVersionId: safeId.optional(),
    poolIds: safeIdArray.optional(),
    dayTypes: z.array(z.string().min(1).max(RULE_LIMITS.maxNameLength)).max(50).optional(),
    customDayCategories: z
      .array(z.string().min(1).max(RULE_LIMITS.maxNameLength))
      .max(50)
      .optional(),
    shiftKeys: z.array(z.string().min(1).max(RULE_LIMITS.maxNameLength)).max(100).optional(),
    slotIds: safeIdArray.optional(),
    pharmacyIds: safeIdArray.optional(),
    pharmacyGroupIds: safeIdArray.optional(),
    serviceAreaIds: safeIdArray.optional(),
    dateRange: z.object({ start: safeDate, end: safeDate }).strict().optional(),
    weekdays: z.array(weekdaySchema).max(7).optional(),
    holidayTypes: z.array(holidayTypeSchema).max(4).optional(),
    generationModes: z.array(generationModeSchema).max(2).optional(),
  })
  .strict();

const exceptionsSchema = z
  .object({
    excludedDates: safeDateArray.optional(),
    includedDates: safeDateArray.optional(),
    excludedWeekdays: z.array(weekdaySchema).max(7).optional(),
    excludedHolidayTypes: z.array(holidayTypeSchema).max(4).optional(),
    excludedPharmacyIds: safeIdArray.optional(),
    excludedPoolIds: safeIdArray.optional(),
    excludedSlotIds: safeIdArray.optional(),
    excludedGenerationModes: z.array(generationModeSchema).max(2).optional(),
  })
  .strict();

const definitionShapeSchema = z
  .object({
    id: safeId,
    ruleType: z.string().min(1).max(RULE_LIMITS.maxNameLength),
    name: z.string().min(1).max(RULE_LIMITS.maxNameLength),
    enabled: z.boolean(),
    severity: z.enum(RULE_SEVERITIES),
    priority: z.number().int().min(0).max(RULE_LIMITS.maxNumericThreshold),
    scope: scopeSchema,
    parameters: z.record(z.string(), z.unknown()),
    validFrom: safeDate.nullable(),
    validTo: safeDate.nullable(),
    exceptions: exceptionsSchema,
    source: z.enum(RULE_SOURCES),
    version: z.number().int().min(1),
    metadata: z
      .object({ description: z.string().max(RULE_LIMITS.maxNameLength).optional() })
      .strict(),
  })
  .strict();

export function validateRuleDefinition(
  definition: ConfiguredRuleDefinition
): RuleDefinitionIssue[] {
  const issues: RuleDefinitionIssue[] = [];
  const ruleId =
    typeof definition?.id === "string" && definition.id.length > 0 ? definition.id : "?";

  const shape = definitionShapeSchema.safeParse(definition);
  if (!shape.success) {
    const issue = shape.error.issues[0];
    issues.push({
      code: "INVALID_SHAPE",
      ruleId,
      detail: issue?.path.join(".") ?? "?",
    });
    return issues;
  }

  const entry = getCatalogueEntry(definition.ruleType);
  if (!entry) {
    issues.push({ code: "UNKNOWN_RULE_TYPE", ruleId, detail: definition.ruleType });
    return issues;
  }

  if (!entry.allowedSeverities.includes(definition.severity)) {
    issues.push({ code: "UNSUPPORTED_SEVERITY", ruleId, detail: definition.severity });
  } else if (!entry.severityConfigurable && definition.severity !== entry.allowedSeverities[0]) {
    issues.push({ code: "SEVERITY_NOT_CONFIGURABLE", ruleId, detail: definition.severity });
  }

  const parameters = entry.parameterSchema.safeParse(definition.parameters);
  if (!parameters.success) {
    issues.push({
      code: "INVALID_PARAMETERS",
      ruleId,
      detail: parameters.error.issues[0]?.path.join(".") || parameters.error.issues[0]?.message || "?",
    });
  }

  for (const dimension of SCOPE_DIMENSIONS) {
    if (definition.scope[dimension] === undefined) continue;
    if (UNSUPPORTED_SCOPE_DIMENSIONS.includes(dimension)) {
      // Stable contract field whose FACTS do not exist yet — a
      // configuration-visible warning; evaluation yields UNSUPPORTED_FACT.
      issues.push({ code: "UNSUPPORTED_FUTURE_SCOPE_DIMENSION", ruleId, detail: dimension });
    } else if (!entry.supportedScopeDimensions.includes(dimension)) {
      issues.push({ code: "UNSUPPORTED_SCOPE_DIMENSION", ruleId, detail: dimension });
    }
  }

  for (const kind of EXCEPTION_KINDS) {
    if (definition.exceptions[kind] === undefined) continue;
    if (!entry.supportedExceptionKinds.includes(kind)) {
      issues.push({ code: "UNSUPPORTED_EXCEPTION_KIND", ruleId, detail: kind });
    }
  }

  if (
    definition.validFrom !== null &&
    definition.validTo !== null &&
    definition.validFrom > definition.validTo
  ) {
    issues.push({ code: "INVALID_VALIDITY_RANGE", ruleId, detail: `${definition.validFrom}>${definition.validTo}` });
  }
  const range = definition.scope.dateRange;
  if (range && range.start > range.end) {
    issues.push({ code: "INVALID_VALIDITY_RANGE", ruleId, detail: `${range.start}>${range.end}` });
  }

  return issues;
}
