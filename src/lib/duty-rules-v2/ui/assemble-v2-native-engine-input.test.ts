import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = {
  region: { findFirst: vi.fn() },
  dutyPlanVersion: { findFirst: vi.fn() },
  dutySchedule: { findUnique: vi.fn() },
};

vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));
// loadDutyPlanVersion is never reached by the pure validation branches
// under test here (every one of them fails before that call) — mocked
// only so the module import itself doesn't require a real DB layer.
vi.mock("../load-duty-plan-version", () => ({ loadDutyPlanVersion: vi.fn() }));

const { assembleV2NativeEngineInput } = await import("./assemble-v2-native-engine-input");

function activeVersion(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "version-1",
    minDaysBetweenDuties: 3,
    relaxMinIntervalWhenInsufficient: true,
    sameDaySecondAssignmentAllowed: false,
    holidayEveWeightSource: "CONFIGURED",
    holidayOverlapResolutionMode: "NATIVE_PRECEDENCE",
    dayTypeRules: [
      { dayType: "WEEKDAY", isServed: true, weight: 1 },
      { dayType: "SATURDAY", isServed: true, weight: 1.5 },
      { dayType: "SUNDAY", isServed: false, weight: null },
    ],
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("assembleV2NativeEngineInput", () => {
  it("rejects an invalid period", async () => {
    const result = await assembleV2NativeEngineInput({
      organizationId: "org-1",
      regionId: "region-1",
      periodStart: "not-a-date",
      periodEnd: "2026-08-31",
    });

    expect(result).toEqual({ ok: false, code: "INVALID_PERIOD", message: expect.any(String) });
    expect(prismaMock.region.findFirst).not.toHaveBeenCalled();
  });

  it("rejects a period where start is after end", async () => {
    const result = await assembleV2NativeEngineInput({
      organizationId: "org-1",
      regionId: "region-1",
      periodStart: "2026-08-31",
      periodEnd: "2026-08-01",
    });

    expect(result).toEqual({ ok: false, code: "INVALID_PERIOD", message: expect.any(String) });
  });

  it("returns REGION_NOT_FOUND when the region doesn't exist or belongs to another organization", async () => {
    prismaMock.region.findFirst.mockResolvedValue(null);

    const result = await assembleV2NativeEngineInput({
      organizationId: "org-1",
      regionId: "region-1",
      periodStart: "2026-08-01",
      periodEnd: "2026-08-31",
    });

    expect(result).toEqual({ ok: false, code: "REGION_NOT_FOUND", message: expect.any(String) });
  });

  it("returns NO_ACTIVE_PHARMACIES when the region has no active pharmacies", async () => {
    prismaMock.region.findFirst.mockResolvedValue({ id: "region-1", pharmacies: [] });

    const result = await assembleV2NativeEngineInput({
      organizationId: "org-1",
      regionId: "region-1",
      periodStart: "2026-08-01",
      periodEnd: "2026-08-31",
    });

    expect(result).toEqual({ ok: false, code: "NO_ACTIVE_PHARMACIES", message: expect.any(String) });
  });

  it("returns NO_ACTIVE_PLAN_VERSION when there is no ACTIVE plan version", async () => {
    prismaMock.region.findFirst.mockResolvedValue({
      id: "region-1",
      pharmacies: [{ id: "pharmacy-1" }],
    });
    prismaMock.dutyPlanVersion.findFirst.mockResolvedValue(null);

    const result = await assembleV2NativeEngineInput({
      organizationId: "org-1",
      regionId: "region-1",
      periodStart: "2026-08-01",
      periodEnd: "2026-08-31",
    });

    expect(result).toEqual({
      ok: false,
      code: "NO_ACTIVE_PLAN_VERSION",
      message: expect.any(String),
    });
  });

  it("returns POLICY_NOT_CONFIGURED when minDaysBetweenDuties is null", async () => {
    prismaMock.region.findFirst.mockResolvedValue({
      id: "region-1",
      pharmacies: [{ id: "pharmacy-1" }],
    });
    prismaMock.dutyPlanVersion.findFirst.mockResolvedValue(
      activeVersion({ minDaysBetweenDuties: null })
    );

    const result = await assembleV2NativeEngineInput({
      organizationId: "org-1",
      regionId: "region-1",
      periodStart: "2026-08-01",
      periodEnd: "2026-08-31",
    });

    expect(result).toEqual({
      ok: false,
      code: "POLICY_NOT_CONFIGURED",
      message: expect.any(String),
    });
  });

  it("returns MISSING_DAY_TYPE_WEIGHT when a served day type has weight: null", async () => {
    prismaMock.region.findFirst.mockResolvedValue({
      id: "region-1",
      pharmacies: [{ id: "pharmacy-1" }],
    });
    prismaMock.dutyPlanVersion.findFirst.mockResolvedValue(
      activeVersion({
        dayTypeRules: [
          { dayType: "WEEKDAY", isServed: true, weight: 1 },
          { dayType: "SATURDAY", isServed: true, weight: null },
        ],
      })
    );

    const result = await assembleV2NativeEngineInput({
      organizationId: "org-1",
      regionId: "region-1",
      periodStart: "2026-08-01",
      periodEnd: "2026-08-31",
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("MISSING_DAY_TYPE_WEIGHT");
    expect(result.message).toContain("Cumartesi");
  });

  it("returns DUPLICATE_SCHEDULE_EXISTS for a single-month period that already has a schedule", async () => {
    prismaMock.region.findFirst.mockResolvedValue({
      id: "region-1",
      pharmacies: [{ id: "pharmacy-1" }],
    });
    prismaMock.dutyPlanVersion.findFirst.mockResolvedValue(activeVersion());
    prismaMock.dutySchedule.findUnique.mockResolvedValue({ id: "existing-schedule" });

    const result = await assembleV2NativeEngineInput({
      organizationId: "org-1",
      regionId: "region-1",
      periodStart: "2026-08-01",
      periodEnd: "2026-08-31",
    });

    expect(result).toEqual({
      ok: false,
      code: "DUPLICATE_SCHEDULE_EXISTS",
      message: expect.any(String),
    });
  });
});
