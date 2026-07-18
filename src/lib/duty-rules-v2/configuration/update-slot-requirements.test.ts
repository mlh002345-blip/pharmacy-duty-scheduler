import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = {
  dutyPlanVersion: { findFirst: vi.fn() },
  dayTypeRule: { findMany: vi.fn() },
  shiftDefinition: { findMany: vi.fn() },
  slotRequirement: { findMany: vi.fn(), deleteMany: vi.fn(), update: vi.fn(), create: vi.fn() },
  rotationPool: { findMany: vi.fn() },
  auditLog: { create: vi.fn() },
  $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn(prismaMock)),
};

vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));

const { setSlotRequirements } = await import("./update-slot-requirements");

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
  prismaMock.dayTypeRule.findMany.mockResolvedValue([{ id: "rule-sat" }]);
  prismaMock.shiftDefinition.findMany.mockResolvedValue([{ id: "shift-1" }]);
  prismaMock.slotRequirement.findMany.mockResolvedValue([]);
  prismaMock.rotationPool.findMany.mockResolvedValue([
    { id: "pool-1", organizationId: "org-1", regionId: "region-1" },
  ]);
});

const validSlot = {
  dayTypeRuleId: "rule-sat",
  shiftDefinitionId: "shift-1",
  rotationPoolId: "pool-1",
  requiredCount: 1,
  sortOrder: 0,
};

describe("setSlotRequirements", () => {
  it("creates slots for a DRAFT version on the happy path", async () => {
    prismaMock.dutyPlanVersion.findFirst.mockResolvedValue(draftVersion());

    const result = await setSlotRequirements({
      organizationId: "org-1",
      versionId: "version-1",
      slots: [validSlot],
      userId: "user-1",
    });

    expect(result).toEqual({ ok: true, count: 1 });
    expect(prismaMock.slotRequirement.create).toHaveBeenCalledTimes(1);
  });

  it("rejects a version belonging to another organization", async () => {
    prismaMock.dutyPlanVersion.findFirst.mockResolvedValue(null);

    const result = await setSlotRequirements({
      organizationId: "org-1",
      versionId: "version-from-other-org",
      slots: [validSlot],
      userId: "user-1",
    });

    expect(result).toEqual({ ok: false, code: "VERSION_NOT_FOUND", message: expect.any(String) });
  });

  it("rejects mutation of a non-DRAFT version", async () => {
    prismaMock.dutyPlanVersion.findFirst.mockResolvedValue(draftVersion({ status: "ACTIVE" }));

    const result = await setSlotRequirements({
      organizationId: "org-1",
      versionId: "version-1",
      slots: [validSlot],
      userId: "user-1",
    });

    expect(result).toEqual({ ok: false, code: "VERSION_NOT_DRAFT", message: expect.any(String) });
  });

  it("rejects a rotation pool belonging to another organization", async () => {
    prismaMock.dutyPlanVersion.findFirst.mockResolvedValue(draftVersion());
    prismaMock.rotationPool.findMany.mockResolvedValue([
      { id: "pool-1", organizationId: "some-other-org", regionId: "region-1" },
    ]);

    const result = await setSlotRequirements({
      organizationId: "org-1",
      versionId: "version-1",
      slots: [validSlot],
      userId: "user-1",
    });

    expect(result).toEqual({ ok: false, code: "UNKNOWN_ROTATION_POOL", message: expect.any(String) });
    expect(prismaMock.slotRequirement.create).not.toHaveBeenCalled();
  });

  it("rejects a slot referencing a dayTypeRuleId not belonging to this version", async () => {
    prismaMock.dutyPlanVersion.findFirst.mockResolvedValue(draftVersion());

    const result = await setSlotRequirements({
      organizationId: "org-1",
      versionId: "version-1",
      slots: [{ ...validSlot, dayTypeRuleId: "rule-from-elsewhere" }],
      userId: "user-1",
    });

    expect(result).toEqual({ ok: false, code: "UNKNOWN_DAY_TYPE_RULE", message: expect.any(String) });
  });

  it("accepts an org-wide pool (regionId null) for the version's region", async () => {
    prismaMock.dutyPlanVersion.findFirst.mockResolvedValue(draftVersion());
    prismaMock.rotationPool.findMany.mockResolvedValue([
      { id: "pool-1", organizationId: "org-1", regionId: null },
    ]);

    const result = await setSlotRequirements({
      organizationId: "org-1",
      versionId: "version-1",
      slots: [validSlot],
      userId: "user-1",
    });

    expect(result).toEqual({ ok: true, count: 1 });
  });
});
