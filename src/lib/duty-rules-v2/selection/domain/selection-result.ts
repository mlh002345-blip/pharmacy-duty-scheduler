// Duty Rules V2 — Phase 6: comparator trace, candidate ranking, and
// provisional selection result contracts.

import type { RankingCriterion, CandidateRankingFacts } from "./ranking-fact";
import type { SelectionDiagnostic } from "./selection-diagnostic";

export type ComparatorStep = {
  criterion: RankingCriterion;
  leftObserved: string;
  rightObserved: string;
  /** -1 = left ranks first, 1 = right ranks first, 0 = tie (continue). */
  result: -1 | 0 | 1;
  tieContinued: boolean;
};

export type CandidateRanking = {
  candidateKey: string;
  strategyId: string;
  strategyType: string;
  rankFacts: CandidateRankingFacts;
  /** The full pairwise trace against the NEXT-BETTER-RANKED candidate
   *  (empty for rank 1). Explains "why is X above Y". */
  comparatorTrace: ComparatorStep[];
  finalStableKey: string;
  provisionalRank: number;
  selected: boolean;
  selectionOrdinal: number | null;
  diagnostics: SelectionDiagnostic[];
};

export type FallbackTraceEntry = {
  strategyId: string;
  strategyType: string;
  attempted: boolean;
  reasonCode: string | null;
  succeeded: boolean;
};

export type ProvisionalSlotSelection = {
  slotKey: string;
  date: string;
  requiredCount: number;
  strategyId: string | null;
  strategyType: string | null;
  /** Ordered by selectionOrdinal. */
  selectedCandidateKeys: string[];
  rankings: CandidateRanking[];
  fallbackChainTrace: FallbackTraceEntry[];
  underfilled: boolean;
  unresolved: boolean;
  diagnostics: SelectionDiagnostic[];
};
