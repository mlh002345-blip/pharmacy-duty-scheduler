import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = {
  pharmacy: { findMany: vi.fn() },
  historicalDutyRecord: { groupBy: vi.fn() },
  dutyBalanceAdjustment: { groupBy: vi.fn() },
  dutyAssignment: { groupBy: vi.fn() },
  // getDutyBalanceRows aggregates HistoricalDutyRecord via a raw SQL
  // GROUP BY (see duty-balance.ts) instead of findMany + JS reduction —
  // moved server-side after full-scale benchmarking showed the unbounded
  // findMany dominating /nobet-dengesi's response time (see
  // docs/security/23-large-data-query-plan-validation.md).
  $queryRaw: vi.fn(),
};

vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));

const { getDutyBalanceRows, getOpeningBalanceByPharmacy } = await import("./duty-balance");

function pharmacy(id: string, name: string, regionName = "Kadıköy") {
  return { id, name, isActive: true, region: { name: regionName } };
}

function historicalGroupRow(
  pharmacyId: string,
  overrides: Partial<{ count: bigint; points: number | null; weekend: bigint; holiday: bigint }> = {}
) {
  return {
    pharmacyId,
    count: overrides.count ?? BigInt(0),
    points: overrides.points ?? 0,
    weekend: overrides.weekend ?? BigInt(0),
    holiday: overrides.holiday ?? BigInt(0),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.$queryRaw.mockResolvedValue([]);
  prismaMock.dutyBalanceAdjustment.groupBy.mockResolvedValue([]);
  prismaMock.dutyAssignment.groupBy.mockResolvedValue([]);
  prismaMock.historicalDutyRecord.groupBy.mockResolvedValue([]);
});

describe("getDutyBalanceRows — zero fallback correctness", () => {
  it("a pharmacy with no historical records, no adjustments, and no generated assignments is zero everywhere, never NaN or undefined", async () => {
    prismaMock.pharmacy.findMany.mockResolvedValue([pharmacy("p1", "Deva Eczanesi")]);

    const rows = await getDutyBalanceRows({ organizationId: "org-1" });

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      historicalCount: 0,
      historicalPoints: 0,
      historicalWeekendCount: 0,
      historicalHolidayCount: 0,
      adjustmentPoints: 0,
      generatedCount: 0,
      generatedPoints: 0,
      totalBalance: 0,
    });
    for (const value of Object.values(rows[0])) {
      if (typeof value === "number") {
        expect(Number.isNaN(value)).toBe(false);
      }
    }
  });
});

describe("getDutyBalanceRows — historical + adjustment + generated combine correctly", () => {
  it("combines a DB-aggregated historical group, adjustment, and generated total", async () => {
    prismaMock.pharmacy.findMany.mockResolvedValue([pharmacy("p1", "Deva Eczanesi")]);
    // Two historical records for the same pharmacy (one Monday at weight 1,
    // one holiday-weight record) already pre-aggregated the way the SQL
    // GROUP BY in duty-balance.ts would return them.
    prismaMock.$queryRaw.mockResolvedValue([
      historicalGroupRow("p1", { count: BigInt(2), points: 2.5, weekend: BigInt(1), holiday: BigInt(1) }),
    ]);
    prismaMock.dutyBalanceAdjustment.groupBy.mockResolvedValue([
      { pharmacyId: "p1", _sum: { points: 3 } },
    ]);
    prismaMock.dutyAssignment.groupBy.mockResolvedValue([
      { pharmacyId: "p1", _sum: { weight: 0.5 }, _count: { _all: 1 } },
    ]);

    const rows = await getDutyBalanceRows({ organizationId: "org-1" });

    expect(rows[0].historicalCount).toBe(2);
    expect(rows[0].historicalPoints).toBe(2.5);
    expect(rows[0].historicalHolidayCount).toBe(1); // weight >= 1.5
    expect(rows[0].adjustmentPoints).toBe(3);
    expect(rows[0].generatedCount).toBe(1);
    expect(rows[0].generatedPoints).toBe(0.5);
    expect(rows[0].totalBalance).toBe(2.5 + 3 + 0.5);
  });

  it("negative adjustments reduce the total balance (not clamped to zero)", async () => {
    prismaMock.pharmacy.findMany.mockResolvedValue([pharmacy("p1", "Deva Eczanesi")]);
    prismaMock.dutyBalanceAdjustment.groupBy.mockResolvedValue([
      { pharmacyId: "p1", _sum: { points: -8 } },
    ]);

    const rows = await getDutyBalanceRows({ organizationId: "org-1" });

    expect(rows[0].adjustmentPoints).toBe(-8);
    expect(rows[0].totalBalance).toBe(-8);
  });

  it("adjustments that net to exactly zero produce a zero adjustmentPoints, same as a pharmacy with no adjustment rows at all", async () => {
    prismaMock.pharmacy.findMany.mockResolvedValue([
      pharmacy("p1", "Net Zero Eczanesi"),
      pharmacy("p2", "No Adjustment Eczanesi"),
    ]);
    prismaMock.dutyBalanceAdjustment.groupBy.mockResolvedValue([
      { pharmacyId: "p1", _sum: { points: 0 } },
      // p2 has no group at all — the ?? 0 fallback path.
    ]);

    const rows = await getDutyBalanceRows({ organizationId: "org-1" });

    const p1 = rows.find((r) => r.pharmacyId === "p1")!;
    const p2 = rows.find((r) => r.pharmacyId === "p2")!;
    expect(p1.adjustmentPoints).toBe(0);
    expect(p2.adjustmentPoints).toBe(0);
    expect(p1.totalBalance).toBe(0);
  });
});

describe("getDutyBalanceRows — pharmacies missing from a grouped query still appear with safe zero fallback", () => {
  it("a pharmacy present in the roster but absent from every grouped aggregate still returns a full zeroed row, not an omitted one", async () => {
    prismaMock.pharmacy.findMany.mockResolvedValue([
      pharmacy("p1", "Eczane A"),
      pharmacy("p2", "Eczane B"),
    ]);
    // Only p1 has any activity in any of the three grouped sources.
    prismaMock.$queryRaw.mockResolvedValue([historicalGroupRow("p1", { count: BigInt(1), points: 2 })]);
    prismaMock.dutyBalanceAdjustment.groupBy.mockResolvedValue([
      { pharmacyId: "p1", _sum: { points: 1 } },
    ]);
    prismaMock.dutyAssignment.groupBy.mockResolvedValue([
      { pharmacyId: "p1", _sum: { weight: 1 }, _count: { _all: 1 } },
    ]);

    const rows = await getDutyBalanceRows({ organizationId: "org-1" });

    expect(rows).toHaveLength(2);
    const p2 = rows.find((r) => r.pharmacyId === "p2")!;
    expect(p2).toMatchObject({
      historicalCount: 0,
      historicalPoints: 0,
      adjustmentPoints: 0,
      generatedCount: 0,
      generatedPoints: 0,
      totalBalance: 0,
    });
  });
});

describe("getDutyBalanceRows — output order follows the DB-provided pharmacy order", () => {
  it("does not re-sort the pharmacies array — order is the caller's (DB orderBy) responsibility, not re-derived in JS", async () => {
    // Deliberately returned in an order that is NOT alphabetical, to prove
    // getDutyBalanceRows just maps 1:1 without its own sort.
    prismaMock.pharmacy.findMany.mockResolvedValue([
      pharmacy("p3", "Zeta Eczanesi"),
      pharmacy("p1", "Alfa Eczanesi"),
      pharmacy("p2", "Beta Eczanesi"),
    ]);

    const rows = await getDutyBalanceRows({ organizationId: "org-1" });

    expect(rows.map((r) => r.pharmacyId)).toEqual(["p3", "p1", "p2"]);
  });
});

describe("getDutyBalanceRows — region scoping reaches every underlying query", () => {
  it("passes regionId through to the pharmacy, historical, adjustment, and generated-assignment queries", async () => {
    prismaMock.pharmacy.findMany.mockResolvedValue([]);

    await getDutyBalanceRows({ organizationId: "org-1", regionId: "region-1" });

    expect(prismaMock.pharmacy.findMany).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        where: { regionId: "region-1", region: { organizationId: "org-1" } },
      })
    );
    // $queryRaw is invoked as a tagged template, so the mock receives
    // (stringsArray, ...substitutions) — the regionId/organizationId are
    // interpolated values rather than a structured `where` object.
    expect(prismaMock.$queryRaw).toHaveBeenCalledOnce();
    expect(prismaMock.$queryRaw.mock.calls[0]).toContain("region-1");
    expect(prismaMock.$queryRaw.mock.calls[0]).toContain("org-1");
    expect(prismaMock.dutyBalanceAdjustment.groupBy).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        where: { pharmacy: { regionId: "region-1", region: { organizationId: "org-1" } } },
      })
    );
    expect(prismaMock.dutyAssignment.groupBy).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        where: { pharmacy: { regionId: "region-1", region: { organizationId: "org-1" } } },
      })
    );
  });

  it("without a regionId, queries are scoped to the whole organization", async () => {
    prismaMock.pharmacy.findMany.mockResolvedValue([]);

    await getDutyBalanceRows({ organizationId: "org-1" });

    expect(prismaMock.pharmacy.findMany).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ where: { region: { organizationId: "org-1" } } })
    );
  });
});

describe("getOpeningBalanceByPharmacy — combines historical and adjustment sources by pharmacyId", () => {
  it("a pharmacy present in both historical and adjustment groups gets the combined total", async () => {
    prismaMock.historicalDutyRecord.groupBy.mockResolvedValue([
      { pharmacyId: "p1", _sum: { weight: 4 } },
    ]);
    prismaMock.dutyBalanceAdjustment.groupBy.mockResolvedValue([
      { pharmacyId: "p1", _sum: { points: 2 } },
    ]);

    const balance = await getOpeningBalanceByPharmacy("region-1");

    expect(balance.get("p1")).toBe(6);
  });

  it("a pharmacy present only in the adjustment group (no historical activity) is not lost", async () => {
    prismaMock.historicalDutyRecord.groupBy.mockResolvedValue([]);
    prismaMock.dutyBalanceAdjustment.groupBy.mockResolvedValue([
      { pharmacyId: "p2", _sum: { points: 5 } },
    ]);

    const balance = await getOpeningBalanceByPharmacy("region-1");

    expect(balance.get("p2")).toBe(5);
  });

  it("a pharmacy present only in the historical group (no manual adjustments) is not lost", async () => {
    prismaMock.historicalDutyRecord.groupBy.mockResolvedValue([
      { pharmacyId: "p3", _sum: { weight: 7 } },
    ]);
    prismaMock.dutyBalanceAdjustment.groupBy.mockResolvedValue([]);

    const balance = await getOpeningBalanceByPharmacy("region-1");

    expect(balance.get("p3")).toBe(7);
  });

  it("returns an empty Map (not an error) when neither source has any rows for the region", async () => {
    const balance = await getOpeningBalanceByPharmacy("region-with-no-data");

    expect(balance.size).toBe(0);
  });
});
