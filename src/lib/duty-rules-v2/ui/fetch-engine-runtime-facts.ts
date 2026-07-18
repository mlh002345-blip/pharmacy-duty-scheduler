// Duty Rules V2 — Phase 12: shared tenant runtime-fact fetching, extracted
// from assemble-v1-compatibility-engine-input.ts (Phase 10).
//
// None of these five facts (holidays, unavailability, duty requests,
// historical duties, balance adjustments) are V1-specific — they are
// plain tenant facts read fresh from the database for a set of
// pharmacies over a period. Both the V1-compatibility assembler and the
// Phase 12 native-policy assembler need the exact same queries, so this
// module is the single source of truth for them. Extracted verbatim
// (same queries, same shaping, same ordering) from the Phase 10 file —
// zero behavior change, see that file's own comment at the call site.
import { prisma } from "@/lib/prisma";
import type {
  EngineBalanceAdjustment,
  EngineDutyRequest,
  EngineHistoricalDuty,
  EngineHoliday,
  EngineUnavailability,
} from "../engine/domain/engine-input";
import { toIsoDate } from "../plan-version-record";

export type FetchEngineRuntimeFactsParams = {
  organizationId: string;
  pharmacyIds: string[];
  /** Date object, inclusive period start. */
  startDate: Date;
  /** Date object, inclusive period end. */
  endDate: Date;
};

export type EngineRuntimeFacts = {
  holidays: EngineHoliday[];
  unavailability: EngineUnavailability[];
  dutyRequests: EngineDutyRequest[];
  historicalDuties: EngineHistoricalDuty[];
  balanceAdjustments: EngineBalanceAdjustment[];
};

/**
 * Fetches the five tenant runtime facts an engine assembler needs, over
 * [startDate, endDate] for the given pharmacies. organizationId is
 * accepted for signature symmetry/future scoping but is not currently
 * used to filter these particular tables (the Phase 10 original didn't
 * scope them by organizationId either — pharmacyIds are already
 * tenant-scoped by the caller before this function is invoked).
 */
export async function fetchEngineRuntimeFacts(
  params: FetchEngineRuntimeFactsParams
): Promise<EngineRuntimeFacts> {
  const { pharmacyIds, startDate, endDate } = params;

  const [holidayRows, unavailabilityRows, dutyRequestRows, historicalRows, balanceRows] =
    await Promise.all([
      prisma.holiday.findMany({
        where: { date: { gte: startDate, lte: endDate } },
      }),
      prisma.unavailability.findMany({
        where: {
          pharmacyId: { in: pharmacyIds },
          startDate: { lte: endDate },
          endDate: { gte: startDate },
        },
      }),
      // Only APPROVED requests affect generation — mirrors V1's own
      // generate-and-save-duty-schedule.ts filter exactly.
      prisma.dutyRequest.findMany({
        where: {
          pharmacyId: { in: pharmacyIds },
          status: "APPROVED",
          startDate: { lte: endDate },
          endDate: { gte: startDate },
        },
      }),
      // Prior COMMITTED assignments strictly before the period start —
      // the Phase-10 interpretation of "historical duties" for fairness/
      // tie-break purposes, analogous to V1's own historicalAssignments
      // input (generate-and-save-duty-schedule.ts's `date: { lt: monthStart }`
      // query). Not a Phase 2-9 concept being re-derived — Engine
      // input's historicalDuties field is documented as
      // caller-supplied fact, and this is this caller's own definition
      // of "prior history" for the region's pharmacies.
      prisma.dutyAssignment.findMany({
        where: {
          pharmacyId: { in: pharmacyIds },
          date: { lt: startDate },
        },
        select: { pharmacyId: true, date: true, weight: true },
        orderBy: { date: "asc" },
      }),
      prisma.dutyBalanceAdjustment.findMany({
        where: { pharmacyId: { in: pharmacyIds } },
        select: { pharmacyId: true, points: true },
      }),
    ]);

  const holidays: EngineHoliday[] = holidayRows.map((h) => ({
    date: toIsoDate(h.date),
    name: h.name,
    type: h.type,
  }));

  const unavailability: EngineUnavailability[] = unavailabilityRows.map((u) => ({
    pharmacyId: u.pharmacyId,
    startDate: toIsoDate(u.startDate),
    endDate: toIsoDate(u.endDate),
  }));

  const dutyRequests: EngineDutyRequest[] = dutyRequestRows.map((r) => ({
    pharmacyId: r.pharmacyId,
    requestType: r.requestType,
    status: r.status,
    startDate: toIsoDate(r.startDate),
    endDate: toIsoDate(r.endDate),
  }));

  const historicalDuties: EngineHistoricalDuty[] = historicalRows.map((a) => ({
    pharmacyId: a.pharmacyId,
    date: toIsoDate(a.date),
    weight: a.weight,
  }));

  // EngineBalanceAdjustment aggregates per pharmacy (the engine input
  // schema forbids duplicate pharmacyId entries in balanceAdjustments) —
  // sum every DutyBalanceAdjustment.points row per pharmacy, mirroring
  // getOpeningBalanceByPharmacy's own aggregation used by V1.
  const balanceByPharmacy = new Map<string, number>();
  for (const row of balanceRows) {
    balanceByPharmacy.set(
      row.pharmacyId,
      (balanceByPharmacy.get(row.pharmacyId) ?? 0) + row.points
    );
  }
  const balanceAdjustments: EngineBalanceAdjustment[] = [...balanceByPharmacy.entries()].map(
    ([pharmacyId, amount]) => ({ pharmacyId, amount })
  );

  return { holidays, unavailability, dutyRequests, historicalDuties, balanceAdjustments };
}
