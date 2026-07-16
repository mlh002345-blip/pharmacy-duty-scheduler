// Duty Rules V2 — Phase 5: shared, safety-bounded parameter primitives.
//
// Every catalogue parameter schema is built from these strict, bounded
// pieces. Limits exist so no configuration can smuggle unbounded data,
// NaN/Infinity, executable-looking content, or oversized payloads into
// evaluation.

import { z } from "zod";

export const RULE_LIMITS = {
  maxPharmacyIdsPerRule: 1000,
  maxExplicitDates: 366,
  maxIdLength: 64,
  maxNameLength: 200,
  maxNumericThreshold: 100000,
  maxArrayLength: 1000,
  maxRulesPerSet: 500,
} as const;

export const safeId = z.string().min(1).max(RULE_LIMITS.maxIdLength);

export const safeIdArray = z
  .array(safeId)
  .max(RULE_LIMITS.maxPharmacyIdsPerRule)
  .refine((ids) => new Set(ids).size === ids.length, { message: "duplicate ids" });

export const safeCount = z
  .number()
  .int()
  .min(0)
  .max(RULE_LIMITS.maxNumericThreshold)
  .finite();

export const safePositiveCount = safeCount.refine((n) => n >= 1, { message: "must be >= 1" });

export const safeLoad = z.number().finite().min(0).max(RULE_LIMITS.maxNumericThreshold);

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
export const safeDate = z.string().regex(ISO_DATE, { message: "YYYY-MM-DD bekleniyor" });

export const safeDateArray = z
  .array(safeDate)
  .max(RULE_LIMITS.maxExplicitDates)
  .refine((dates) => new Set(dates).size === dates.length, { message: "duplicate dates" });
