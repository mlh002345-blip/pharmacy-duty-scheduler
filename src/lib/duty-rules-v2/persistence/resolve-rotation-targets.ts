// Duty Rules V2 — Phase 9: resolves which RotationState row(s) a
// generation run's persisted assignments touch, and in what order they
// served each membership — the shared read used by BOTH
// approve-generated-draft.ts (to snapshot the "expected" lockVersions)
// and publish-approved-schedule.ts (to compute the actual advancement).
// Using the exact same resolver in both places guarantees the
// optimistic-lock snapshot and the real update always agree on scope.
//
// Read-only. Never mutates anything. Groups by the SAME rule
// resolve-rotation-facts.ts already uses to READ state (an exact
// dayTypeScope match wins, else the pool's "ALL" state, else no state at
// all for that pool) — see pickRotationStateScope.

import type { Prisma, PrismaClient } from "@prisma/client";

import { parseCarriedForward, type CarriedForwardEntry } from "../rotation-state";
import { dayTypeKeyFromSlotKey, pickRotationStateScope } from "./advance-rotation-state";

type PrismaClientOrTx = PrismaClient | Prisma.TransactionClient;

export type RotationTarget = {
  rotationStateId: string;
  poolId: string;
  dayTypeScope: string;
  priorCurrentRound: number;
  priorLastServedMembershipId: string | null;
  priorCarriedForward: CarriedForwardEntry[];
  priorLockVersion: number;
  /** Chronological (date ASC, then selectionOrdinal ASC). */
  servedMembershipIdsInOrder: string[];
  /** The pool's currently-open (leftAt: null) memberships, id ASC —
   *  deliberately NOT a full temporal as-of-date resolution (that would
   *  be re-deriving Phase 4's pool snapshot logic); a simple "currently
   *  open" set is sufficient for round-distance math and does not
   *  duplicate Phase 4/7 eligibility computation. */
  activeMembershipIdsInOrder: string[];
};

/** Returns one RotationTarget per DISTINCT RotationState row actually
 *  touched by this generation run's persisted assignments — never a
 *  pool/scope the assignments don't reference. */
export async function resolveRotationTargets(
  client: PrismaClientOrTx,
  generationRunId: string
): Promise<RotationTarget[]> {
  const assignments = await client.dutyAssignment.findMany({
    where: { generationRunId },
    select: { membershipId: true, slotKey: true, date: true, selectionOrdinal: true },
    orderBy: [{ date: "asc" }, { selectionOrdinal: "asc" }],
  });

  const membershipIds = [...new Set(assignments.map((a) => a.membershipId).filter((id): id is string => id !== null))];
  if (membershipIds.length === 0) return [];

  const memberships = await client.rotationPoolMembership.findMany({
    where: { id: { in: membershipIds } },
    select: { id: true, poolId: true },
  });
  const poolIdByMembershipId = new Map(memberships.map((m) => [m.id, m.poolId]));

  const poolIds = [...new Set(memberships.map((m) => m.poolId))];
  if (poolIds.length === 0) return [];

  const [pools, activeMemberships] = await Promise.all([
    client.rotationPool.findMany({
      where: { id: { in: poolIds } },
      select: {
        id: true,
        rotationStates: {
          select: {
            id: true,
            dayTypeScope: true,
            currentRound: true,
            lastServedMembershipId: true,
            carriedForward: true,
            lockVersion: true,
          },
        },
      },
    }),
    client.rotationPoolMembership.findMany({
      where: { poolId: { in: poolIds }, leftAt: null },
      select: { id: true, poolId: true },
      orderBy: { id: "asc" },
    }),
  ]);
  const statesByPoolId = new Map(pools.map((p) => [p.id, p.rotationStates]));
  const activeByPoolId = new Map<string, string[]>();
  for (const m of activeMemberships) {
    const list = activeByPoolId.get(m.poolId) ?? [];
    list.push(m.id);
    activeByPoolId.set(m.poolId, list);
  }

  // rotationStateId -> accumulated target (chronological order preserved
  // via the outer assignments loop, which is already date/ordinal sorted).
  const targets = new Map<string, RotationTarget>();

  for (const assignment of assignments) {
    if (!assignment.membershipId || !assignment.slotKey) continue;
    const poolId = poolIdByMembershipId.get(assignment.membershipId);
    if (!poolId) continue;
    const dayTypeKey = dayTypeKeyFromSlotKey(assignment.slotKey);
    if (!dayTypeKey) continue;

    const states = statesByPoolId.get(poolId) ?? [];
    const state = pickRotationStateScope(states, dayTypeKey);
    if (!state) continue; // pool has no configured RotationState — nothing to advance.

    const existing = targets.get(state.id);
    if (existing) {
      existing.servedMembershipIdsInOrder.push(assignment.membershipId);
      continue;
    }
    targets.set(state.id, {
      rotationStateId: state.id,
      poolId,
      dayTypeScope: state.dayTypeScope,
      priorCurrentRound: state.currentRound,
      priorLastServedMembershipId: state.lastServedMembershipId,
      priorCarriedForward: parseCarriedForward(state.carriedForward),
      priorLockVersion: state.lockVersion,
      servedMembershipIdsInOrder: [assignment.membershipId],
      activeMembershipIdsInOrder: activeByPoolId.get(poolId) ?? [],
    });
  }

  return [...targets.values()].sort((a, b) => a.rotationStateId.localeCompare(b.rotationStateId));
}
