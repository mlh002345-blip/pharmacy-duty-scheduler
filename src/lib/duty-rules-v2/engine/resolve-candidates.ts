// Duty Rules V2 engine — Stage 6: candidate resolver.
//
// Converts one slot's pool memberships into candidate FACT objects. Every
// membership row that could conceivably matter is represented — active-
// as-of members AND memberships excluded by the snapshot — because the
// eligibility evaluator (Stage 7) must be able to EXPLAIN each exclusion,
// not just observe an absence. No eligibility decision happens here.
//
// All facts are derived deterministically from explicit runtime input;
// nothing reads the clock, the database, or ambient state.

import type { EligibilityReasonCode } from "./domain/diagnostics";
import type {
  DutyEngineInput,
  EngineDutyRequest,
  EngineExistingAssignment,
  EngineHistoricalDuty,
  EngineUnavailability,
} from "./domain/engine-input";
import { dateInWindow, diffInDays } from "./domain/dates";
import type { ResolvedPool } from "./resolve-pool";
import type { ResolvedSlot } from "./resolve-slots";

// ---------------------------------------------------------------------------
// Runtime fact indexes: built ONCE per run from validated input (pure).
// ---------------------------------------------------------------------------

export type RuntimeFactIndex = {
  unavailabilityByPharmacy: Map<string, EngineUnavailability[]>;
  blockingRequestsByPharmacy: Map<string, EngineDutyRequest[]>;
  preferRequestsByPharmacy: Map<string, EngineDutyRequest[]>;
  historicalByPharmacy: Map<string, EngineHistoricalDuty[]>;
  balanceByPharmacy: Map<string, number>;
  assignmentsByPharmacy: Map<string, EngineExistingAssignment[]>;
};

export function indexRuntimeFacts(input: DutyEngineInput): RuntimeFactIndex {
  // Only APPROVED requests have any effect — exactly V1's rule
  // (generate-duty-schedule.ts:191). CANNOT_DUTY and EMERGENCY_EXCUSE
  // block; PREFER_DUTY is a fairness preference; SWAP_REQUEST has no
  // engine effect in V1 and none here.
  const approved = input.dutyRequests.filter((request) => request.status === "APPROVED");
  return {
    unavailabilityByPharmacy: groupBy(input.unavailability, (r) => r.pharmacyId),
    blockingRequestsByPharmacy: groupBy(
      approved.filter(
        (r) => r.requestType === "CANNOT_DUTY" || r.requestType === "EMERGENCY_EXCUSE"
      ),
      (r) => r.pharmacyId
    ),
    preferRequestsByPharmacy: groupBy(
      approved.filter((r) => r.requestType === "PREFER_DUTY"),
      (r) => r.pharmacyId
    ),
    historicalByPharmacy: groupBy(input.historicalDuties, (r) => r.pharmacyId),
    balanceByPharmacy: input.balanceAdjustments.reduce((map, adjustment) => {
      map.set(adjustment.pharmacyId, (map.get(adjustment.pharmacyId) ?? 0) + adjustment.amount);
      return map;
    }, new Map<string, number>()),
    assignmentsByPharmacy: groupBy(input.existingAssignments, (r) => r.pharmacyId),
  };
}

function groupBy<T>(items: T[], key: (item: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const list = map.get(key(item)) ?? [];
    list.push(item);
    map.set(key(item), list);
  }
  return map;
}

// ---------------------------------------------------------------------------
// Candidates.
// ---------------------------------------------------------------------------

export type SlotCandidate = {
  /** Deterministic key: "{slotKey}#{membershipId}". */
  candidateKey: string;
  slotKey: string;
  date: string;
  poolId: string;
  membershipId: string;
  pharmacyId: string;
  /** Needed only for the V1-compatible Turkish-locale tie-break. */
  pharmacyName: string;
  pharmacyIsActive: boolean;
  sortIndex: number | null;
  /** null = active member as of the slot date; otherwise the snapshot's
   *  exclusion, mapped to an eligibility reason (NOT_A_MEMBER or
   *  PHARMACY_INACTIVE). */
  membershipExclusion: Extract<
    EligibilityReasonCode,
    "NOT_A_MEMBER" | "PHARMACY_INACTIVE"
  > | null;
  // Runtime facts observed for THIS date (decisions belong to Stage 7):
  unavailableOnDate: boolean;
  blockingRequestType: "CANNOT_DUTY" | "EMERGENCY_EXCUSE" | null;
  prefersThisDate: boolean;
  /** Same-slot and same-day existing assignments (explicit input). */
  assignedToThisSlot: boolean;
  assignedSameDayElsewhere: boolean;
  // Load facts (historical + period assignments before/at this date):
  historicalDutyCount: number;
  historicalWeightedLoad: number;
  historicalWeekendCount: number;
  balanceAdjustment: number;
  periodAssignments: { date: string; weight: number; slotKey: string | null }[];
  /** Latest duty date from history + period assignments, or null. */
  lastDutyDate: string | null;
  daysSinceLastDuty: number | null;
};

export function resolveCandidates(
  slot: ResolvedSlot,
  pool: ResolvedPool,
  facts: RuntimeFactIndex
): SlotCandidate[] {
  const exclusionByMembership = new Map(
    pool.snapshot.excluded.map((entry) => [entry.membershipId, entry.reason])
  );
  const activeMembershipIds = new Set(pool.snapshot.eligible.map((e) => e.membershipId));

  const candidates = pool.memberships
    .filter(
      (membership) =>
        activeMembershipIds.has(membership.id) || exclusionByMembership.has(membership.id)
    )
    .map((membership) => {
      const pharmacyId = membership.pharmacyId;
      const unavailable = (facts.unavailabilityByPharmacy.get(pharmacyId) ?? []).some((window) =>
        dateInWindow(slot.date, window.startDate, window.endDate)
      );
      const blocking = (facts.blockingRequestsByPharmacy.get(pharmacyId) ?? []).filter((request) =>
        dateInWindow(slot.date, request.startDate, request.endDate)
      );
      // EMERGENCY_EXCUSE outranks CANNOT_DUTY in the reported fact when
      // both cover the date (both block identically in V1).
      const blockingRequestType = blocking.some((r) => r.requestType === "EMERGENCY_EXCUSE")
        ? ("EMERGENCY_EXCUSE" as const)
        : blocking.length > 0
          ? ("CANNOT_DUTY" as const)
          : null;
      const prefersThisDate = (facts.preferRequestsByPharmacy.get(pharmacyId) ?? []).some(
        (request) => dateInWindow(slot.date, request.startDate, request.endDate)
      );

      const history = facts.historicalByPharmacy.get(pharmacyId) ?? [];
      const periodAssignments = (facts.assignmentsByPharmacy.get(pharmacyId) ?? [])
        .filter((assignment) => assignment.date <= slot.date)
        .map((assignment) => ({
          date: assignment.date,
          weight: assignment.weight,
          slotKey: assignment.slotKey,
        }))
        .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

      const dutyDates = [
        ...history.map((h) => h.date),
        ...periodAssignments.filter((a) => a.date < slot.date).map((a) => a.date),
      ];
      const lastDutyDate = dutyDates.length === 0 ? null : dutyDates.reduce((a, b) => (a > b ? a : b));

      const snapshotExclusion = exclusionByMembership.get(membership.id);
      return {
        candidateKey: `${slot.slotKey}#${membership.id}`,
        slotKey: slot.slotKey,
        date: slot.date,
        poolId: pool.poolId,
        membershipId: membership.id,
        pharmacyId,
        pharmacyName: membership.pharmacyName,
        pharmacyIsActive: membership.pharmacyIsActive,
        sortIndex: membership.sortIndex,
        membershipExclusion:
          snapshotExclusion === undefined
            ? null
            : snapshotExclusion === "PHARMACY_INACTIVE"
              ? ("PHARMACY_INACTIVE" as const)
              : ("NOT_A_MEMBER" as const),
        unavailableOnDate: unavailable,
        blockingRequestType,
        prefersThisDate,
        assignedToThisSlot: periodAssignments.some((a) => a.slotKey === slot.slotKey),
        assignedSameDayElsewhere: periodAssignments.some(
          (a) => a.date === slot.date && a.slotKey !== slot.slotKey
        ),
        historicalDutyCount: history.length,
        historicalWeightedLoad: history.reduce((sum, h) => sum + h.weight, 0),
        historicalWeekendCount: history.filter((h) => {
          const weekday = new Date(`${h.date}T00:00:00.000Z`).getUTCDay();
          return weekday === 0 || weekday === 6;
        }).length,
        balanceAdjustment: facts.balanceByPharmacy.get(pharmacyId) ?? 0,
        periodAssignments,
        lastDutyDate,
        daysSinceLastDuty: lastDutyDate === null ? null : diffInDays(slot.date, lastDutyDate),
      } satisfies SlotCandidate;
    });

  candidates.sort((a, b) =>
    a.candidateKey < b.candidateKey ? -1 : a.candidateKey > b.candidateKey ? 1 : 0
  );
  return candidates;
}
