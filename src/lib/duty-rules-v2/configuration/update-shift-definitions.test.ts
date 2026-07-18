import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = {
  dutyPlanVersion: { findFirst: vi.fn() },
  shiftDefinition: { findMany: vi.fn(), deleteMany: vi.fn(), update: vi.fn(), create: vi.fn() },
  auditLog: { create: vi.fn() },
  $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn(prismaMock)),
};

vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));

const { setShiftDefinitions } = await import("./update-shift-definitions");

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
  prismaMock.shiftDefinition.findMany.mockResolvedValue([]);
});

const validShift = {
  name: "Günlük Nöbet",
  startMinute: 0,
  endMinute: 1439,
  spansMidnight: false,
  defaultWeight: 1,
  sortOrder: 0,
};

describe("setShiftDefinitions", () => {
  it("creates shifts for a DRAFT version on the happy path", async () => {
    prismaMock.dutyPlanVersion.findFirst.mockResolvedValue(draftVersion());

    const result = await setShiftDefinitions({
      organizationId: "org-1",
      versionId: "version-1",
      shifts: [validShift],
      userId: "user-1",
    });

    expect(result).toEqual({ ok: true, count: 1 });
    expect(prismaMock.shiftDefinition.create).toHaveBeenCalledTimes(1);
  });

  it("rejects a version belonging to another organization", async () => {
    prismaMock.dutyPlanVersion.findFirst.mockResolvedValue(null);

    const result = await setShiftDefinitions({
      organizationId: "org-1",
      versionId: "version-from-other-org",
      shifts: [validShift],
      userId: "user-1",
    });

    expect(result).toEqual({ ok: false, code: "VERSION_NOT_FOUND", message: expect.any(String) });
  });

  it("rejects mutation of a non-DRAFT version", async () => {
    prismaMock.dutyPlanVersion.findFirst.mockResolvedValue(draftVersion({ status: "RETIRED" }));

    const result = await setShiftDefinitions({
      organizationId: "org-1",
      versionId: "version-1",
      shifts: [validShift],
      userId: "user-1",
    });

    expect(result).toEqual({ ok: false, code: "VERSION_NOT_DRAFT", message: expect.any(String) });
  });

  it("rejects duplicate shift names within the same call, before touching the database", async () => {
    const result = await setShiftDefinitions({
      organizationId: "org-1",
      versionId: "version-1",
      shifts: [validShift, { ...validShift, sortOrder: 1 }],
      userId: "user-1",
    });

    expect(result).toEqual({ ok: false, code: "DUPLICATE_NAME", message: expect.any(String) });
    expect(prismaMock.dutyPlanVersion.findFirst).not.toHaveBeenCalled();
  });

  it("deletes a shift removed from the input", async () => {
    prismaMock.dutyPlanVersion.findFirst.mockResolvedValue(draftVersion());
    prismaMock.shiftDefinition.findMany.mockResolvedValue([{ id: "shift-old" }]);

    await setShiftDefinitions({
      organizationId: "org-1",
      versionId: "version-1",
      shifts: [validShift],
      userId: "user-1",
    });

    expect(prismaMock.shiftDefinition.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ["shift-old"] } },
    });
  });
});
