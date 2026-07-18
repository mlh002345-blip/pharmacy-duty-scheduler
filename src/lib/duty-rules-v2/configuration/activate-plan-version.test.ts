import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = {
  dutyPlanVersion: {
    findFirst: vi.fn(),
    findUnique: vi.fn(),
    updateMany: vi.fn(),
    findMany: vi.fn(),
    update: vi.fn(),
  },
  auditLog: { create: vi.fn() },
  $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn(prismaMock)),
};

const checkPlanVersionActivationReadiness = vi.fn();

vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));
vi.mock("./validate-plan-version-completeness", () => ({
  checkPlanVersionActivationReadiness: (...args: unknown[]) =>
    checkPlanVersionActivationReadiness(...args),
}));

const { activatePlanVersion } = await import("./activate-plan-version");

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => fn(prismaMock));
  checkPlanVersionActivationReadiness.mockResolvedValue({ ok: true, advisoryIssues: [] });
  prismaMock.dutyPlanVersion.findMany.mockResolvedValue([]);
});

describe("activatePlanVersion", () => {
  it("activates a ready DRAFT version and retires the region's other ACTIVE version", async () => {
    prismaMock.dutyPlanVersion.findFirst.mockResolvedValue({
      id: "version-2",
      status: "DRAFT",
      validFrom: new Date("2026-03-01T00:00:00.000Z"),
    });
    prismaMock.dutyPlanVersion.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.dutyPlanVersion.findMany.mockResolvedValue([
      { id: "version-1", validTo: null },
    ]);

    const result = await activatePlanVersion({
      organizationId: "org-1",
      regionId: "region-1",
      planVersionId: "version-2",
      userId: "user-1",
    });

    expect(result).toEqual({
      ok: true,
      outcome: "ACTIVATED",
      planVersionId: "version-2",
      retiredVersionIds: ["version-1"],
    });
    expect(prismaMock.dutyPlanVersion.update).toHaveBeenCalledWith({
      where: { id: "version-1" },
      data: { status: "RETIRED", retiredAt: expect.any(Date), validTo: new Date("2026-02-28T00:00:00.000Z") },
    });
  });

  it("never widens an already-narrower validTo on the version being retired", async () => {
    prismaMock.dutyPlanVersion.findFirst.mockResolvedValue({
      id: "version-2",
      status: "DRAFT",
      validFrom: new Date("2026-03-01T00:00:00.000Z"),
    });
    prismaMock.dutyPlanVersion.updateMany.mockResolvedValue({ count: 1 });
    const earlierValidTo = new Date("2026-01-15T00:00:00.000Z");
    prismaMock.dutyPlanVersion.findMany.mockResolvedValue([
      { id: "version-1", validTo: earlierValidTo },
    ]);

    await activatePlanVersion({
      organizationId: "org-1",
      regionId: "region-1",
      planVersionId: "version-2",
      userId: "user-1",
    });

    expect(prismaMock.dutyPlanVersion.update).toHaveBeenCalledWith({
      where: { id: "version-1" },
      data: { status: "RETIRED", retiredAt: expect.any(Date), validTo: earlierValidTo },
    });
  });

  it("returns IDEMPOTENT_REPLAY for an already-ACTIVE version instead of an error", async () => {
    prismaMock.dutyPlanVersion.findFirst.mockResolvedValue({
      id: "version-2",
      status: "ACTIVE",
      validFrom: new Date("2026-03-01T00:00:00.000Z"),
    });

    const result = await activatePlanVersion({
      organizationId: "org-1",
      regionId: "region-1",
      planVersionId: "version-2",
      userId: "user-1",
    });

    expect(result).toEqual({
      ok: true,
      outcome: "IDEMPOTENT_REPLAY",
      planVersionId: "version-2",
      retiredVersionIds: [],
    });
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it("rejects activating a version that isn't DRAFT or ACTIVE (e.g. RETIRED)", async () => {
    prismaMock.dutyPlanVersion.findFirst.mockResolvedValue({
      id: "version-2",
      status: "RETIRED",
      validFrom: new Date("2026-03-01T00:00:00.000Z"),
    });

    const result = await activatePlanVersion({
      organizationId: "org-1",
      regionId: "region-1",
      planVersionId: "version-2",
      userId: "user-1",
    });

    expect(result).toEqual({ ok: false, code: "NOT_DRAFT", message: expect.any(String) });
  });

  it("rejects activation with blocking readiness issues and surfaces them", async () => {
    prismaMock.dutyPlanVersion.findFirst.mockResolvedValue({
      id: "version-2",
      status: "DRAFT",
      validFrom: new Date("2026-03-01T00:00:00.000Z"),
    });
    checkPlanVersionActivationReadiness.mockResolvedValue({
      ok: false,
      blockingIssues: [{ code: "SLOT_WITHOUT_POOL", subjectId: "slot-1" }],
      advisoryIssues: [],
    });

    const result = await activatePlanVersion({
      organizationId: "org-1",
      regionId: "region-1",
      planVersionId: "version-2",
      userId: "user-1",
    });

    expect(result).toEqual({
      ok: false,
      code: "NOT_READY",
      message: expect.any(String),
      blockingIssues: [{ code: "SLOT_WITHOUT_POOL", subjectId: "slot-1" }],
    });
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it("rejects a version belonging to another organization/region", async () => {
    prismaMock.dutyPlanVersion.findFirst.mockResolvedValue(null);

    const result = await activatePlanVersion({
      organizationId: "org-1",
      regionId: "region-1",
      planVersionId: "version-from-other-org",
      userId: "user-1",
    });

    expect(result).toEqual({ ok: false, code: "VERSION_NOT_FOUND", message: expect.any(String) });
  });

  it("recovers a lost race (updateMany count 0) as an idempotent replay when the winner is now ACTIVE", async () => {
    prismaMock.dutyPlanVersion.findFirst.mockResolvedValue({
      id: "version-2",
      status: "DRAFT",
      validFrom: new Date("2026-03-01T00:00:00.000Z"),
    });
    prismaMock.dutyPlanVersion.updateMany.mockResolvedValue({ count: 0 });
    prismaMock.dutyPlanVersion.findUnique.mockResolvedValue({ status: "ACTIVE" });

    const result = await activatePlanVersion({
      organizationId: "org-1",
      regionId: "region-1",
      planVersionId: "version-2",
      userId: "user-1",
    });

    expect(result).toEqual({
      ok: true,
      outcome: "IDEMPOTENT_REPLAY",
      planVersionId: "version-2",
      retiredVersionIds: [],
    });
  });
});
