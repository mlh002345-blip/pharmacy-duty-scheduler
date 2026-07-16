// Duty Rules V2 engine — Stage 5: pool resolver.
//
// Resolves one slot's rotation pool as of the slot's date, reusing the
// Phase 3 membership-boundary logic (resolvePoolMembershipAsOf) — the
// joinedOn-inclusive / leftOn-exclusive semantics are defined exactly
// once, there. Tenant/region mismatches CANNOT reach this stage: the
// loader fails the whole load on them, so they are never membership
// exclusions here.

import type { LoadedDutyPlanVersion, LoadedRotationPool, ResolvedPoolMembershipSnapshot, RotationStrategyValue } from "../domain/loaded-plan";
import { resolvePoolMembershipAsOf } from "../resolve-pool-membership";
import type { EngineDiagnostic } from "./domain/diagnostics";
import type { ResolvedSlot } from "./resolve-slots";

export type ResolvedPool = {
  slotKey: string;
  poolId: string;
  /** The pool's stable human key: its name (unique per organization). */
  poolKey: string;
  strategy: RotationStrategyValue;
  regionId: string | null;
  snapshot: ResolvedPoolMembershipSnapshot;
  /** Full temporal membership rows (resolution inputs, for provenance). */
  memberships: LoadedRotationPool["memberships"];
  rotationStates: LoadedRotationPool["rotationStates"];
  diagnostics: EngineDiagnostic[];
};

export function resolvePool(
  slot: ResolvedSlot,
  plan: LoadedDutyPlanVersion
): ResolvedPool | null {
  if (slot.poolId === null) return null; // Already diagnosed by the slot stage.
  const pool = plan.rotationPools.find((p) => p.id === slot.poolId);
  if (!pool) return null; // Loader guarantees presence; defensive.

  const diagnostics: EngineDiagnostic[] = [];
  const snapshot = resolvePoolMembershipAsOf(pool, slot.date);
  if (pool.memberships.length === 0) {
    diagnostics.push({ code: "EMPTY_POOL", date: slot.date, subjectKey: pool.id });
  } else if (snapshot.eligible.length === 0) {
    diagnostics.push({ code: "NO_ACTIVE_MEMBERS", date: slot.date, subjectKey: pool.id });
  }

  return {
    slotKey: slot.slotKey,
    poolId: pool.id,
    poolKey: pool.name,
    strategy: pool.strategy,
    regionId: pool.regionId,
    snapshot,
    memberships: pool.memberships,
    rotationStates: pool.rotationStates,
    diagnostics,
  };
}
