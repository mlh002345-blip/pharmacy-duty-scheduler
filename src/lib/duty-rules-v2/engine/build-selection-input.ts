// Duty Rules V2 engine — Stage 11: selection input builder.
//
// Assembles everything the FUTURE selection engine (Phase 5) needs for
// one date/slot into a deterministic, self-contained SelectionInput. No
// winner is selected here.
//
// SNAPSHOT PROVENANCE (mandatory): the configuration fingerprint alone is
// NOT sufficient provenance — pharmacy active state and other runtime
// eligibility facts are deliberately excluded from it — so every
// SelectionInput additionally carries a membershipSnapshotHash (the
// resolved as-of snapshot INCLUDING active flags and exclusion reasons)
// and the run-level runtimeInputHash.

import { createHash } from "node:crypto";

import type { RotationStrategyValue } from "../domain/loaded-plan";
import { canonicalSerialize } from "../v1-adapter";
import type { RuleEvaluationResult } from "../rules/domain/rule-evaluation";
import type { EngineDiagnostic } from "./domain/diagnostics";
import type { CandidateFairnessFacts } from "./calculate-fairness-facts";
import type { CandidateRotationFacts } from "./resolve-rotation-facts";
import type { CandidateEligibilityResult } from "./evaluate-eligibility";
import type { EligibilityRelaxationResult } from "./apply-eligibility-relaxation";
import type { ResolvedPool } from "./resolve-pool";
import type { ResolvedSlot } from "./resolve-slots";
import type { SlotCandidate } from "./resolve-candidates";

export function sha256Canonical(value: unknown): string {
  return createHash("sha256").update(canonicalSerialize(value)).digest("hex");
}

/** Hash of one pool's resolved as-of snapshot INCLUDING pharmacy active
 *  state and exclusion reasons — the runtime-sensitive complement to the
 *  configuration fingerprint. */
export function membershipSnapshotHash(pool: ResolvedPool): string {
  return sha256Canonical({
    poolKey: pool.poolKey,
    effectiveDate: pool.snapshot.effectiveDate,
    eligible: pool.snapshot.eligible,
    excluded: pool.snapshot.excluded,
    memberActiveFlags: pool.memberships
      .map((m) => ({ membershipId: m.id, isActive: m.pharmacyIsActive }))
      .sort((a, b) => (a.membershipId < b.membershipId ? -1 : 1)),
  });
}

export type SelectionProvenance = {
  configurationFingerprint: string;
  membershipSnapshotHash: string;
  effectiveDate: string;
  runtimeInputHash: string;
  /** Phase 5: canonical hash of the configured rule set (empty-set hash
   *  when no rules are supplied). The full provenance package is FIVE
   *  values: configuration, membership snapshot, runtime input, rule
   *  set, and the draft result fingerprint. */
  ruleSetFingerprint: string;
  /** Phase 6: canonical hash of the configured selection-strategy set
   *  (empty-set hash when no strategies are supplied). Covers strategy
   *  CONFIGURATION only — see canonicalize-strategy-set.ts for why
   *  pharmacy-name tie-break effects are deliberately excluded here and
   *  captured in provisionalSelectionFingerprint instead. */
  strategySetFingerprint: string;
  loaderVersion: number;
  engineVersion: number;
};

export type SelectionInput = {
  slot: ResolvedSlot;
  requiredCount: number;
  strategy: RotationStrategyValue;
  /** All candidates with their facts, sorted by candidateKey. */
  candidates: SlotCandidate[];
  eligibility: CandidateEligibilityResult[];
  relaxation: EligibilityRelaxationResult;
  fairnessFacts: CandidateFairnessFacts[];
  rotationFacts: CandidateRotationFacts[];
  /** Phase 5: configured-rule outcomes for this slot (canonical order).
   *  Empty when no rules are configured. */
  ruleEvaluations: RuleEvaluationResult[];
  diagnostics: EngineDiagnostic[];
  provenance: SelectionProvenance;
};

export function buildSelectionInput(input: {
  slot: ResolvedSlot;
  pool: ResolvedPool;
  candidates: SlotCandidate[];
  eligibility: CandidateEligibilityResult[];
  relaxation: EligibilityRelaxationResult;
  fairnessFacts: CandidateFairnessFacts[];
  rotationFacts: CandidateRotationFacts[];
  ruleEvaluations: RuleEvaluationResult[];
  diagnostics: EngineDiagnostic[];
  configurationFingerprint: string;
  runtimeInputHash: string;
  ruleSetFingerprint: string;
  strategySetFingerprint: string;
  loaderVersion: number;
  engineVersion: number;
}): SelectionInput {
  const byKey = (a: { candidateKey: string }, b: { candidateKey: string }) =>
    a.candidateKey < b.candidateKey ? -1 : a.candidateKey > b.candidateKey ? 1 : 0;

  return {
    slot: input.slot,
    requiredCount: input.slot.requiredCount,
    strategy: input.pool.strategy,
    candidates: [...input.candidates].sort(byKey),
    eligibility: [...input.eligibility].sort(byKey),
    relaxation: input.relaxation,
    fairnessFacts: [...input.fairnessFacts].sort(byKey),
    rotationFacts: [...input.rotationFacts].sort(byKey),
    ruleEvaluations: input.ruleEvaluations,
    diagnostics: input.diagnostics,
    provenance: {
      configurationFingerprint: input.configurationFingerprint,
      membershipSnapshotHash: membershipSnapshotHash(input.pool),
      effectiveDate: input.slot.date,
      runtimeInputHash: input.runtimeInputHash,
      ruleSetFingerprint: input.ruleSetFingerprint,
      strategySetFingerprint: input.strategySetFingerprint,
      loaderVersion: input.loaderVersion,
      engineVersion: input.engineVersion,
    },
  };
}
