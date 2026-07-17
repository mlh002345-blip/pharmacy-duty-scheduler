// Duty Rules V2 — Phase 6: the assembled platform strategy catalogue.
//
// This map IS the security boundary — only strategy types present here
// can ever be resolved, and every comparator is platform code. RANDOMIZED
// is explicitly prohibited by the product: it is never registered here,
// and any definition referencing it is rejected as UNKNOWN_STRATEGY_TYPE
// (validate-strategy-definition.ts also special-cases it to a more
// specific RANDOM_STRATEGY_REJECTED conflict for a clearer signal).

import type { StrategyCatalogueEntry } from "../domain/strategy-catalogue";
import { FAIRNESS_LEAST_LOAD, WEIGHTED_FAIRNESS } from "./fairness-strategies";
import { MANUAL_ORDER, SEQUENTIAL_ROTATION } from "./rotation-strategies";
import { HYBRID_ROTATION_FAIRNESS, LEXICOGRAPHIC_CHAIN } from "./chain-strategies";
import { V1_COMPATIBILITY_CHAIN } from "./v1-compatibility-strategy";

const ENTRIES: StrategyCatalogueEntry[] = [
  FAIRNESS_LEAST_LOAD,
  SEQUENTIAL_ROTATION,
  MANUAL_ORDER,
  WEIGHTED_FAIRNESS,
  LEXICOGRAPHIC_CHAIN,
  HYBRID_ROTATION_FAIRNESS,
  V1_COMPATIBILITY_CHAIN,
];

export const STRATEGY_CATALOGUE: ReadonlyMap<string, StrategyCatalogueEntry> = new Map(
  ENTRIES.map((entry) => [entry.strategyType, entry])
);

/** Explicitly prohibited strategy type names — never implementable by
 *  this catalogue, checked before the generic "unknown type" path so
 *  the conflict is unambiguous. */
export const PROHIBITED_STRATEGY_TYPES: ReadonlySet<string> = new Set([
  "RANDOMIZED",
  "RANDOM",
  "RANDOM_ORDER",
]);

export function getStrategyCatalogueEntry(strategyType: string): StrategyCatalogueEntry | null {
  return STRATEGY_CATALOGUE.get(strategyType) ?? null;
}
