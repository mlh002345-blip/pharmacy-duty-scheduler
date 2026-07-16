// Duty Rules V2 engine — Stage 9: rotation facts resolver.
//
// Per-candidate rotation FACTS for all four strategies. Nothing here
// advances the cursor, modifies RotationState, or mutates the
// carried-forward ledger — the inputs are read-only snapshots from the
// loader, and this module only derives positions and distances.
//
// State scope resolution: a state whose dayTypeScope equals the slot's
// day-type key wins; otherwise the "ALL" state applies; otherwise there
// is no rotation state (all cursor facts null). Strategy-specific FINAL
// comparison is deferred to the selection phase — the facts are complete
// here.

import type { LoadedRotationState } from "../domain/loaded-plan";
import type { ResolvedPool } from "./resolve-pool";
import type { SlotCandidate } from "./resolve-candidates";

export type CandidateRotationFacts = {
  candidateKey: string;
  membershipId: string;
  strategy: ResolvedPool["strategy"];
  /** The applicable state's scope ("ALL", a day-type key, …) or null. */
  stateScope: string | null;
  currentRound: number | null;
  cursorMembershipId: string | null;
  isCursor: boolean;
  sortIndex: number | null;
  /** Position inside the pool's ORDERED active-as-of membership list
   *  (the snapshot's deterministic ordering), or null when not active. */
  manualOrderPosition: number | null;
  /** Steps AFTER the cursor in the ordered active list, wrapping around
   *  (cursor itself = pool size, "just served"); null without a cursor
   *  in the active list or without a position. */
  distanceFromCursor: number | null;
  /** Carry-forward entries owed to THIS membership (persisted order). */
  carriedForward: { reason: "SKIPPED" | "UNAVAILABLE"; periodKey: string }[];
};

export function resolveRotationFacts(
  candidate: SlotCandidate,
  pool: ResolvedPool,
  dayTypeKey: string
): CandidateRotationFacts {
  const state = pickState(pool.rotationStates, dayTypeKey);

  const orderedActive = pool.snapshot.eligible.map((entry) => entry.membershipId);
  const position = orderedActive.indexOf(candidate.membershipId);
  const cursorPosition =
    state?.lastServedMembershipId == null
      ? -1
      : orderedActive.indexOf(state.lastServedMembershipId);

  let distanceFromCursor: number | null = null;
  if (position >= 0 && cursorPosition >= 0) {
    const size = orderedActive.length;
    const distance = (position - cursorPosition + size) % size;
    // The cursor itself was just served: distance wraps to a full round.
    distanceFromCursor = distance === 0 ? size : distance;
  }

  return {
    candidateKey: candidate.candidateKey,
    membershipId: candidate.membershipId,
    strategy: pool.strategy,
    stateScope: state?.dayTypeScope ?? null,
    currentRound: state?.currentRound ?? null,
    cursorMembershipId: state?.lastServedMembershipId ?? null,
    isCursor: state?.lastServedMembershipId === candidate.membershipId,
    sortIndex: candidate.sortIndex,
    manualOrderPosition: position >= 0 ? position : null,
    distanceFromCursor,
    carriedForward: (state?.carriedForward ?? [])
      .filter((entry) => entry.membershipId === candidate.membershipId)
      .map((entry) => ({ reason: entry.reason, periodKey: entry.periodKey })),
  };
}

function pickState(
  states: LoadedRotationState[],
  dayTypeKey: string
): LoadedRotationState | null {
  return (
    states.find((state) => state.dayTypeScope === dayTypeKey) ??
    states.find((state) => state.dayTypeScope === "ALL") ??
    null
  );
}
