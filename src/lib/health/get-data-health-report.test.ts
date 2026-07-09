import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = {
  region: { findMany: vi.fn() },
  pharmacy: { findMany: vi.fn() },
  $queryRaw: vi.fn(),
  dutyRequest: { count: vi.fn() },
  historicalDutyRecord: { count: vi.fn(), groupBy: vi.fn() },
  holiday: { count: vi.fn() },
  dutyRule: { count: vi.fn() },
  dutySchedule: { count: vi.fn() },
};

vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));

const { getDataHealthReport } = await import("./data-health");

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.region.findMany.mockResolvedValue([]);
  prismaMock.pharmacy.findMany.mockResolvedValue([]);
  prismaMock.$queryRaw.mockResolvedValue([]);
  prismaMock.dutyRequest.count.mockResolvedValue(0);
  prismaMock.historicalDutyRecord.count.mockResolvedValue(0);
  prismaMock.historicalDutyRecord.groupBy.mockResolvedValue([]);
  prismaMock.holiday.count.mockResolvedValue(0);
  prismaMock.dutyRule.count.mockResolvedValue(0);
  prismaMock.dutySchedule.count.mockResolvedValue(0);
});

describe("getDataHealthReport — short-lived TTL cache", () => {
  it("returns a cached result within the TTL without re-querying the database", async () => {
    const t0 = 1_000_000;
    await getDataHealthReport({ now: t0 });
    expect(prismaMock.region.findMany).toHaveBeenCalledOnce();

    await getDataHealthReport({ now: t0 + 30_000 }); // 30s later, still within 60s TTL
    expect(prismaMock.region.findMany).toHaveBeenCalledOnce(); // not called again
  });

  it("recomputes once the TTL has elapsed", async () => {
    const t0 = 2_000_000;
    await getDataHealthReport({ now: t0 });
    expect(prismaMock.region.findMany).toHaveBeenCalledOnce();

    await getDataHealthReport({ now: t0 + 60_001 }); // just past the 60s TTL
    expect(prismaMock.region.findMany).toHaveBeenCalledTimes(2);
  });

  it("returns the same report shape on a cache hit as on a fresh computation", async () => {
    const t0 = 3_000_000;
    prismaMock.holiday.count.mockResolvedValue(0); // triggers a WARNING finding

    const first = await getDataHealthReport({ now: t0 });
    const second = await getDataHealthReport({ now: t0 + 1000 });

    expect(second).toEqual(first);
    expect(first.warnings.some((w) => w.message.includes("Tatil günleri tanımlanmamış"))).toBe(
      true
    );
  });
});

describe("getDataHealthReport — invalid unavailability date ranges", () => {
  it("fetches only invalid unavailability rows via a DB-filtered query, not a full-table load", async () => {
    prismaMock.$queryRaw.mockResolvedValue([
      { pharmacyName: "Merkez Eczanesi", startDate: new Date("2026-07-10"), endDate: new Date("2026-07-05") },
    ]);

    const report = await getDataHealthReport({ now: 4_000_000 });

    expect(prismaMock.$queryRaw).toHaveBeenCalledOnce();
    expect(
      report.critical.some(
        (f) =>
          f.affected === "Merkez Eczanesi" &&
          f.message.includes("mazeret bitiş tarihi başlangıç tarihinden önce")
      )
    ).toBe(true);
  });

  it("does not report anything when the DB-filtered query returns no invalid rows", async () => {
    prismaMock.$queryRaw.mockResolvedValue([]);

    const report = await getDataHealthReport({ now: 5_000_000 });

    expect(
      report.critical.some((f) => f.message.includes("mazeret bitiş tarihi başlangıç tarihinden önce"))
    ).toBe(false);
  });
});
