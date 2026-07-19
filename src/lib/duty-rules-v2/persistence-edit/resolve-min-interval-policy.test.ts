import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = {
  dutySchedule: { findFirst: vi.fn() },
};

vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));

const { resolveMinIntervalPolicy } = await import("./resolve-min-interval-policy");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("resolveMinIntervalPolicy", () => {
  it("prefers the native plan-version policy even when a legacy DutyRule value is also present", async () => {
    prismaMock.dutySchedule.findFirst.mockResolvedValue({
      generationRun: { planVersion: { minDaysBetweenDuties: 5 } },
      region: { dutyRule: { minDaysBetweenDuties: 10 } },
    });

    const result = await resolveMinIntervalPolicy({
      dutyScheduleId: "schedule-1",
      organizationId: "org-1",
    });

    expect(result).toEqual({ minDaysBetweenDuties: 5 });
  });

  it("falls back to the region's DutyRule when the plan version has no native policy configured", async () => {
    prismaMock.dutySchedule.findFirst.mockResolvedValue({
      generationRun: { planVersion: { minDaysBetweenDuties: null } },
      region: { dutyRule: { minDaysBetweenDuties: 7 } },
    });

    const result = await resolveMinIntervalPolicy({
      dutyScheduleId: "schedule-1",
      organizationId: "org-1",
    });

    expect(result).toEqual({ minDaysBetweenDuties: 7 });
  });

  it("falls back to the region's DutyRule for a V1 schedule (no generationRun at all)", async () => {
    prismaMock.dutySchedule.findFirst.mockResolvedValue({
      generationRun: null,
      region: { dutyRule: { minDaysBetweenDuties: 3 } },
    });

    const result = await resolveMinIntervalPolicy({
      dutyScheduleId: "schedule-1",
      organizationId: "org-1",
    });

    expect(result).toEqual({ minDaysBetweenDuties: 3 });
  });

  it("returns null when neither a native policy nor a DutyRule is present", async () => {
    prismaMock.dutySchedule.findFirst.mockResolvedValue({
      generationRun: { planVersion: { minDaysBetweenDuties: null } },
      region: { dutyRule: null },
    });

    const result = await resolveMinIntervalPolicy({
      dutyScheduleId: "schedule-1",
      organizationId: "org-1",
    });

    expect(result).toBeNull();
  });

  it("returns null when the schedule itself cannot be found", async () => {
    prismaMock.dutySchedule.findFirst.mockResolvedValue(null);

    const result = await resolveMinIntervalPolicy({
      dutyScheduleId: "missing",
      organizationId: "org-1",
    });

    expect(result).toBeNull();
  });

  it("scopes the lookup by the caller's own organizationId (tenant isolation, defense-in-depth)", async () => {
    prismaMock.dutySchedule.findFirst.mockResolvedValue(null);

    await resolveMinIntervalPolicy({ dutyScheduleId: "schedule-1", organizationId: "org-1" });

    expect(prismaMock.dutySchedule.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "schedule-1", region: { organizationId: "org-1" } },
      })
    );
  });
});
