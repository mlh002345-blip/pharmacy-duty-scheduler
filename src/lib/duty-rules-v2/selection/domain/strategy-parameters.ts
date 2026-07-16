// Duty Rules V2 — Phase 6: shared, safety-bounded parameter primitives
// for strategy definitions. Mirrors rules/domain/rule-parameters.ts.

import { z } from "zod";

import { TIE_BREAKER_CODES, RANKING_CRITERIA } from "./ranking-fact";

export const STRATEGY_LIMITS = {
  maxStrategiesPerSet: 20,
  maxTieBreakersPerStrategy: 20,
  maxFallbackLevels: 10,
  minWeight: -1000,
  maxWeight: 1000,
  maxNameLength: 200,
  maxLexicographicCriteria: 20,
} as const;

export const safeId = z.string().min(1).max(64);

export const safeWeight = z
  .number()
  .finite()
  .min(STRATEGY_LIMITS.minWeight)
  .max(STRATEGY_LIMITS.maxWeight);

export const tieBreakerChainSchema = z
  .array(z.enum(TIE_BREAKER_CODES))
  .max(STRATEGY_LIMITS.maxTieBreakersPerStrategy)
  .refine((chain) => new Set(chain).size === chain.length, {
    message: "duplicate tie-breaker in chain",
  });

export const lexicographicCriteriaSchema = z
  .array(z.enum(RANKING_CRITERIA))
  .min(1)
  .max(STRATEGY_LIMITS.maxLexicographicCriteria)
  .refine((chain) => new Set(chain).size === chain.length, {
    message: "duplicate criterion in chain",
  });
