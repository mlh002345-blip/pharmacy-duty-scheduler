// Duty Rules V2 — Phase 5: the assembled platform rule catalogue.
//
// This map IS the security boundary: only rule types present here can
// ever be evaluated, and every evaluator is platform code. Nothing a
// chamber supplies can add, replace, or modify an entry.

import type { RuleCatalogueEntry } from "../domain/rule-catalogue";
import {
  BLOCK_APPROVED_CANNOT_DUTY_REQUEST,
  BLOCK_APPROVED_EMERGENCY_EXCUSE,
  EXCLUDE_PHARMACY,
  INCLUDE_ONLY_PHARMACIES,
  MEMBER_OF_POOL_AS_OF_DATE,
  PHARMACY_MUST_BE_ACTIVE,
  PHARMACY_UNAVAILABLE_ON_DATE,
  SAME_SLOT_DUPLICATE_FORBIDDEN,
} from "./eligibility-rules";
import {
  MAX_ASSIGNMENTS_IN_PERIOD,
  MAX_WEIGHTED_LOAD_IN_PERIOD,
  MIN_DAYS_BETWEEN_ASSIGNMENTS,
  SAME_DAY_ASSIGNMENT_LIMIT,
} from "./interval-load-rules";
import {
  AVOID_CONSECUTIVE_HOLIDAY_ASSIGNMENTS,
  AVOID_CONSECUTIVE_WEEKEND_ASSIGNMENTS,
  MINIMUM_REST_AFTER_SHIFT,
  PREFER_REQUESTED_DATE,
} from "./pattern-preference-rules";
import {
  CUSTOM_DATE_OVERRIDE,
  GROUP_COMBINATION_FORBIDDEN,
  POOL_QUOTA,
  TAG_COMBINATION_FORBIDDEN,
} from "./structure-rules";

const ENTRIES: RuleCatalogueEntry[] = [
  PHARMACY_MUST_BE_ACTIVE,
  MEMBER_OF_POOL_AS_OF_DATE,
  PHARMACY_UNAVAILABLE_ON_DATE,
  BLOCK_APPROVED_CANNOT_DUTY_REQUEST,
  BLOCK_APPROVED_EMERGENCY_EXCUSE,
  MIN_DAYS_BETWEEN_ASSIGNMENTS,
  SAME_DAY_ASSIGNMENT_LIMIT,
  SAME_SLOT_DUPLICATE_FORBIDDEN,
  MAX_ASSIGNMENTS_IN_PERIOD,
  MAX_WEIGHTED_LOAD_IN_PERIOD,
  PREFER_REQUESTED_DATE,
  AVOID_CONSECUTIVE_WEEKEND_ASSIGNMENTS,
  AVOID_CONSECUTIVE_HOLIDAY_ASSIGNMENTS,
  MINIMUM_REST_AFTER_SHIFT,
  EXCLUDE_PHARMACY,
  INCLUDE_ONLY_PHARMACIES,
  POOL_QUOTA,
  TAG_COMBINATION_FORBIDDEN,
  GROUP_COMBINATION_FORBIDDEN,
  CUSTOM_DATE_OVERRIDE,
];

export const RULE_CATALOGUE: ReadonlyMap<string, RuleCatalogueEntry> = new Map(
  ENTRIES.map((entry) => [entry.ruleType, entry])
);

export function getCatalogueEntry(ruleType: string): RuleCatalogueEntry | null {
  return RULE_CATALOGUE.get(ruleType) ?? null;
}
