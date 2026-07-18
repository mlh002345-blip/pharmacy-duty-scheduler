import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = {
  dutyPlanVersion: { findFirst: vi.fn() },
  dayTypeRule: { findMany: vi.fn(), deleteMany: vi.fn(), update: vi.fn(), create: vi.fn() },
  auditLog: { create: vi.fn() },
  $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn(prismaMock)),
};

vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));

const { setDayTypeRules } = await import("./update-day-type-rules");

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

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => fn(prismaMock));
  prismaMock.dayTypeRule.findMany.mockResolvedValue([]);
});

describe("setDayTypeRules", () => {
  it("creates rules for a DRAFT version on the happy path", async () => {
    prismaMock.dutyPlanVersion.findFirst.mockResolvedValue(draftVersion());

    const result = await setDayTypeRules({
      organizationId: "org-1",
      versionId: "version-1",
      rules: [
        { dayType: "SATURDAY", isServed: true },
        { dayType: "WEEKDAY", isServed: false },
      ],
      userId: "user-1",
    });

    expect(result).toEqual({ ok: true, count: 2 });
    expect(prismaMock.dayTypeRule.create).toHaveBeenCalledTimes(2);
    expect(prismaMock.auditLog.create).toHaveBeenCalledTimes(1);
  });

  it("updates existing rows in place, preserving id, instead of delete+recreate", async () => {
    prismaMock.dutyPlanVersion.findFirst.mockResolvedValue(draftVersion());
    prismaMock.dayTypeRule.findMany.mockResolvedValue([
      { id: "rule-sat", dayType: "SATURDAY", customDayCategory: null },
    ]);

    const result = await setDayTypeRules({
      organizationId: "org-1",
      versionId: "version-1",
      rules: [{ dayType: "SATURDAY", isServed: false }],
      userId: "user-1",
    });

    expect(result).toEqual({ ok: true, count: 1 });
    expect(prismaMock.dayTypeRule.update).toHaveBeenCalledWith({
      where: { id: "rule-sat" },
      data: { isServed: false, weight: null },
    });
    expect(prismaMock.dayTypeRule.create).not.toHaveBeenCalled();
    expect(prismaMock.dayTypeRule.deleteMany).not.toHaveBeenCalled();
  });

  it("deletes rows genuinely absent from the new input", async () => {
    prismaMock.dutyPlanVersion.findFirst.mockResolvedValue(draftVersion());
    prismaMock.dayTypeRule.findMany.mockResolvedValue([
      { id: "rule-sun", dayType: "SUNDAY", customDayCategory: null },
    ]);

    await setDayTypeRules({
      organizationId: "org-1",
      versionId: "version-1",
      rules: [{ dayType: "SATURDAY", isServed: true }],
      userId: "user-1",
    });

    expect(prismaMock.dayTypeRule.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ["rule-sun"] } },
    });
  });

  it("rejects a version belonging to another organization", async () => {
    prismaMock.dutyPlanVersion.findFirst.mockResolvedValue(null);

    const result = await setDayTypeRules({
      organizationId: "org-1",
      versionId: "version-from-other-org",
      rules: [{ dayType: "SATURDAY", isServed: true }],
      userId: "user-1",
    });

    expect(result).toEqual({ ok: false, code: "VERSION_NOT_FOUND", message: expect.any(String) });
    expect(prismaMock.dayTypeRule.create).not.toHaveBeenCalled();
  });

  it("rejects mutation of a non-DRAFT (ACTIVE) version — edit-frozen", async () => {
    prismaMock.dutyPlanVersion.findFirst.mockResolvedValue(draftVersion({ status: "ACTIVE" }));

    const result = await setDayTypeRules({
      organizationId: "org-1",
      versionId: "version-1",
      rules: [{ dayType: "SATURDAY", isServed: true }],
      userId: "user-1",
    });

    expect(result).toEqual({ ok: false, code: "VERSION_NOT_DRAFT", message: expect.any(String) });
    expect(prismaMock.dayTypeRule.create).not.toHaveBeenCalled();
  });

  it("rejects a duplicate day type within the same call", async () => {
    const result = await setDayTypeRules({
      organizationId: "org-1",
      versionId: "version-1",
      rules: [
        { dayType: "SATURDAY", isServed: true },
        { dayType: "SATURDAY", isServed: false },
      ],
      userId: "user-1",
    });

    expect(result).toEqual({ ok: false, code: "DUPLICATE_DAY_TYPE", message: expect.any(String) });
    expect(prismaMock.dutyPlanVersion.findFirst).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------
  // Duty Rules V2 — Phase 12: weight field
  // -------------------------------------------------------------------

  it("persists a valid weight on create", async () => {
    prismaMock.dutyPlanVersion.findFirst.mockResolvedValue(draftVersion());

    const result = await setDayTypeRules({
      organizationId: "org-1",
      versionId: "version-1",
      rules: [{ dayType: "SATURDAY", isServed: true, weight: 1.5 }],
      userId: "user-1",
    });

    expect(result).toEqual({ ok: true, count: 1 });
    expect(prismaMock.dayTypeRule.create).toHaveBeenCalledWith({
      data: {
        planVersionId: "version-1",
        dayType: "SATURDAY",
        isServed: true,
        customDayCategory: null,
        weight: 1.5,
      },
    });
  });

  it("accepts weight: null as an unconfigured value", async () => {
    prismaMock.dutyPlanVersion.findFirst.mockResolvedValue(draftVersion());

    const result = await setDayTypeRules({
      organizationId: "org-1",
      versionId: "version-1",
      rules: [{ dayType: "SATURDAY", isServed: true, weight: null }],
      userId: "user-1",
    });

    expect(result).toEqual({ ok: true, count: 1 });
    expect(prismaMock.dayTypeRule.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ weight: null }) })
    );
  });

  it.each([0, -1, NaN])("rejects an invalid weight (%s) with INVALID_WEIGHT", async (badWeight) => {
    const result = await setDayTypeRules({
      organizationId: "org-1",
      versionId: "version-1",
      rules: [{ dayType: "SATURDAY", isServed: true, weight: badWeight }],
      userId: "user-1",
    });

    expect(result).toEqual({ ok: false, code: "INVALID_WEIGHT", message: expect.any(String) });
    expect(prismaMock.dutyPlanVersion.findFirst).not.toHaveBeenCalled();
  });

  it("preserves weight across an update that only changes isServed", async () => {
    prismaMock.dutyPlanVersion.findFirst.mockResolvedValue(draftVersion());
    prismaMock.dayTypeRule.findMany.mockResolvedValue([
      { id: "rule-sat", dayType: "SATURDAY", customDayCategory: null },
    ]);

    const result = await setDayTypeRules({
      organizationId: "org-1",
      versionId: "version-1",
      rules: [{ dayType: "SATURDAY", isServed: false, weight: 2.25 }],
      userId: "user-1",
    });

    expect(result).toEqual({ ok: true, count: 1 });
    expect(prismaMock.dayTypeRule.update).toHaveBeenCalledWith({
      where: { id: "rule-sat" },
      data: { isServed: false, weight: 2.25 },
    });
  });
});
