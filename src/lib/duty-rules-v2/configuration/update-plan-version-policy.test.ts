import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = {
  dutyPlanVersion: { findFirst: vi.fn(), update: vi.fn() },
  auditLog: { create: vi.fn() },
  $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn(prismaMock)),
};

vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));

const { setPlanVersionPolicy } = await import("./update-plan-version-policy");

function draftVersion(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "version-1",
    status: "DRAFT",
    versionNumber: 1,
    validFrom: new Date("2026-01-01"),
    validTo: null,
    planId: "plan-1",
    plan: { regionId: "region-1", organizationId: "org-1" },
    ...overrides,
  };
}

function validInput(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    organizationId: "org-1",
    versionId: "version-1",
    minDaysBetweenDuties: 5,
    relaxMinIntervalWhenInsufficient: true,
    sameDaySecondAssignmentAllowed: false,
    holidayEveWeightSource: "CONFIGURED" as const,
    holidayOverlapResolutionMode: "NATIVE_PRECEDENCE" as const,
    userId: "user-1",
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => fn(prismaMock));
});

describe("setPlanVersionPolicy", () => {
  it("updates policy on the happy path", async () => {
    prismaMock.dutyPlanVersion.findFirst.mockResolvedValue(draftVersion());

    const result = await setPlanVersionPolicy(validInput());

    expect(result).toEqual({ ok: true });
    expect(prismaMock.dutyPlanVersion.update).toHaveBeenCalledWith({
      where: { id: "version-1" },
      data: {
        minDaysBetweenDuties: 5,
        relaxMinIntervalWhenInsufficient: true,
        sameDaySecondAssignmentAllowed: false,
        holidayEveWeightSource: "CONFIGURED",
        holidayOverlapResolutionMode: "NATIVE_PRECEDENCE",
      },
    });
    expect(prismaMock.auditLog.create).toHaveBeenCalledTimes(1);
  });

  it("accepts null minDaysBetweenDuties as an explicit clear", async () => {
    prismaMock.dutyPlanVersion.findFirst.mockResolvedValue(draftVersion());

    const result = await setPlanVersionPolicy(validInput({ minDaysBetweenDuties: null }));

    expect(result).toEqual({ ok: true });
    expect(prismaMock.dutyPlanVersion.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ minDaysBetweenDuties: null }) })
    );
  });

  it("rejects a version belonging to another organization", async () => {
    prismaMock.dutyPlanVersion.findFirst.mockResolvedValue(null);

    const result = await setPlanVersionPolicy(validInput({ organizationId: "org-other" }));

    expect(result).toEqual({ ok: false, code: "VERSION_NOT_FOUND", message: expect.any(String) });
    expect(prismaMock.dutyPlanVersion.update).not.toHaveBeenCalled();
  });

  it("rejects mutation of a non-DRAFT (ACTIVE) version — edit-frozen", async () => {
    prismaMock.dutyPlanVersion.findFirst.mockResolvedValue(draftVersion({ status: "ACTIVE" }));

    const result = await setPlanVersionPolicy(validInput());

    expect(result).toEqual({ ok: false, code: "VERSION_NOT_DRAFT", message: expect.any(String) });
    expect(prismaMock.dutyPlanVersion.update).not.toHaveBeenCalled();
  });

  it("rejects a negative minDaysBetweenDuties", async () => {
    const result = await setPlanVersionPolicy(validInput({ minDaysBetweenDuties: -1 }));

    expect(result).toEqual({
      ok: false,
      code: "INVALID_MIN_DAYS_BETWEEN_DUTIES",
      message: expect.any(String),
    });
    expect(prismaMock.dutyPlanVersion.findFirst).not.toHaveBeenCalled();
  });

  it("rejects a non-integer minDaysBetweenDuties", async () => {
    const result = await setPlanVersionPolicy(validInput({ minDaysBetweenDuties: 2.5 }));

    expect(result).toEqual({
      ok: false,
      code: "INVALID_MIN_DAYS_BETWEEN_DUTIES",
      message: expect.any(String),
    });
    expect(prismaMock.dutyPlanVersion.findFirst).not.toHaveBeenCalled();
  });
});
