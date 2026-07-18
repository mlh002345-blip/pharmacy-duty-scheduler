// Duty Rules V2 — Phase 9: RotationState advancement.
//
// This module is the FIRST writer of RotationState.currentRound/
// lastServedMembershipId/carriedForward/lockVersion anywhere in this
// codebase — nothing before Phase 9 ever advances this table (see the
// model's own header comment in prisma/schema.prisma, and
// resolve-rotation-facts.ts's read-only "Stage 9" role). There is no
// prior specification to conform to; the algorithm below is deliberately
// documented in full so its assumptions are auditable.
//
// Never re-runs Phase 4-7. Every input here is either a persisted
// DutyAssignment fact (membershipId, slotKey) or a freshly-read
// RotationState/RotationPoolMembership row — no eligibility, ranking, or
// fairness computation happens here.

import type { CarriedForwardEntry } from "../rotation-state";

/** Extracts the dayTypeKey segment from a persisted slotKey
 *  ("{date}:{dayTypeKey}:{shiftKey}:{sortOrder}" — see
 *  resolve-slots.ts and the DRAFT_SLOT_KEY_FORMAT_INVALID validator,
 *  which guarantees every committed assignment's slotKey has this exact
 *  shape). Parsing an already-computed, already-validated string field
 *  is not "re-deriving Phase 4-7" — it is reading a fact Phase 7 already
 *  committed to permanent storage. */
export function dayTypeKeyFromSlotKey(slotKey: string): string | null {
  const parts = slotKey.split(":");
  return parts.length >= 2 ? parts[1] : null;
}

/** Mirrors resolve-rotation-facts.ts's pickState exactly: a RotationState
 *  scoped to the exact day type wins; otherwise the pool's "ALL"-scoped
 *  state applies; otherwise there is no rotation state for this pool at
 *  all (nothing to advance for it — not an error, just out of scope). */
export function pickRotationStateScope<T extends { dayTypeScope: string }>(
  states: T[],
  dayTypeKey: string
): T | null {
  return states.find((s) => s.dayTypeScope === dayTypeKey) ?? states.find((s) => s.dayTypeScope === "ALL") ?? null;
}

export type RotationAdvancementInput = {
  currentRound: number;
  lastServedMembershipId: string | null;
  carriedForward: CarriedForwardEntry[];
  /** Membership ids served by this publication, in the exact
   *  chronological order they were assigned (date ASC, then
   *  selectionOrdinal ASC within a date) — the same order Phase 6's own
   *  sequential accumulator processed them in. */
  servedMembershipIdsInOrder: string[];
  /** The pool's current active membership ids, in one stable,
   *  deterministic order (id ASC) — the same ordering used consistently
   *  on every call, so distance/round math is reproducible. */
  activeMembershipIdsInOrder: string[];
};

export type RotationAdvancementResult = {
  currentRound: number;
  lastServedMembershipId: string | null;
  carriedForward: CarriedForwardEntry[];
};

/**
 * Pure, deterministic RotationState advancement.
 *
 * ALGORITHM (documented in full — there is no prior implementation to
 * match):
 *  - lastServedMembershipId becomes the LAST membership served in this
 *    batch (restates reality faithfully, even for a membership that has
 *    since left the pool).
 *  - currentRound advances by the number of full passes through the
 *    pool's active membership list this batch consumed, using the EXACT
 *    same "distance from cursor, 0 wraps to a full pool size" formula
 *    resolve-rotation-facts.ts already uses to READ distanceFromCursor —
 *    so the write-side round math is symmetric with the pre-existing
 *    read-side model, not an independently-invented one. Cumulative
 *    distance across every served membership in the batch is summed,
 *    then divided by the active pool size (floor) to get whole rounds.
 *  - A served membership with no position in the CURRENT active list
 *    (left the pool since generation) still becomes the new cursor but
 *    contributes zero distance, since there is no position to measure
 *    from.
 *  - The very first served membership when there was no PRIOR cursor
 *    (lastServedMembershipId was null) contributes zero distance — it
 *    only sets the cursor. Nothing was "skipped" to reach it.
 *  - carriedForward: this phase never INVENTS a new debt (that would
 *    require re-running Phase 4 eligibility for every non-selected
 *    candidate, explicitly out of scope). It only CLEARS an existing
 *    debt entry when that exact membership was actually served in this
 *    batch — the debt is paid off, never silently dropped otherwise.
 */
export function computeRotationAdvancement(input: RotationAdvancementInput): RotationAdvancementResult {
  const { activeMembershipIdsInOrder, servedMembershipIdsInOrder } = input;
  const size = activeMembershipIdsInOrder.length;

  let cursor = input.lastServedMembershipId;
  let round = input.currentRound;
  let cumulativeDistance = 0;

  for (const servedId of servedMembershipIdsInOrder) {
    const servedPos = activeMembershipIdsInOrder.indexOf(servedId);
    if (servedPos === -1) {
      cursor = servedId;
      continue;
    }
    const cursorPos = cursor ? activeMembershipIdsInOrder.indexOf(cursor) : -1;
    let distance = 0;
    if (cursorPos !== -1 && size > 0) {
      const raw = (servedPos - cursorPos + size) % size;
      distance = raw === 0 ? size : raw;
    }
    cumulativeDistance += distance;
    cursor = servedId;
  }

  if (size > 0) {
    round += Math.floor(cumulativeDistance / size);
  }

  const servedSet = new Set(servedMembershipIdsInOrder);
  const carriedForward = input.carriedForward.filter((entry) => !servedSet.has(entry.membershipId));

  return {
    currentRound: round,
    lastServedMembershipId: cursor,
    carriedForward,
  };
}
