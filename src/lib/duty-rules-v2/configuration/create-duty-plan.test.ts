import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = {
  region: { findFirst: vi.fn() },
  dutyPlan: { create: vi.fn() },
  dutyPlanVersion: { create: vi.fn() },
  auditLog: { create: vi.fn() },
  $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn(prismaMock)),
};

vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));

const { createDutyPlan } = await import("./create-duty-plan");

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => fn(prismaMock));
});

describe("createDutyPlan", () => {
  it("creates a plan and its first DRAFT version on the happy path", async () => {
    prismaMock.region.findFirst.mockResolvedValue({ id: "region-1" });
    prismaMock.dutyPlan.create.mockResolvedValue({ id: "plan-1" });
    prismaMock.dutyPlanVersion.create.mockResolvedValue({ id: "version-1" });

    const result = await createDutyPlan({
      organizationId: "org-1",
      regionId: "region-1",
      name: "Pelitli Planı",
      userId: "user-1",
    });

    expect(result).toEqual({ ok: true, planId: "plan-1", versionId: "version-1" });
    expect(prismaMock.dutyPlanVersion.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ versionNumber: 1, status: "DRAFT", planId: "plan-1" }),
      })
    );
    expect(prismaMock.auditLog.create).toHaveBeenCalledTimes(1);
  });

  it("rejects a region belonging to another organization (tenant mismatch is indistinguishable from not-found)", async () => {
    prismaMock.region.findFirst.mockResolvedValue(null);

    const result = await createDutyPlan({
      organizationId: "org-1",
      regionId: "region-from-other-org",
      name: "Plan",
      userId: "user-1",
    });

    expect(result).toEqual({ ok: false, code: "REGION_NOT_FOUND", message: expect.any(String) });
    expect(prismaMock.dutyPlan.create).not.toHaveBeenCalled();
  });

  it("rejects an empty plan name without touching the database", async () => {
    const result = await createDutyPlan({
      organizationId: "org-1",
      regionId: "region-1",
      name: "   ",
      userId: "user-1",
    });

    expect(result).toEqual({ ok: false, code: "INVALID_INPUT", message: expect.any(String) });
    expect(prismaMock.region.findFirst).not.toHaveBeenCalled();
  });
});
