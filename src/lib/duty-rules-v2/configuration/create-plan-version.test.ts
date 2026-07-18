import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = {
  dutyPlan: { findFirst: vi.fn() },
  dutyPlanVersion: { aggregate: vi.fn(), create: vi.fn() },
  auditLog: { create: vi.fn() },
  $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn(prismaMock)),
};

vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));

const { createPlanVersion } = await import("./create-plan-version");

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => fn(prismaMock));
});

describe("createPlanVersion", () => {
  it("creates the next version number under an existing plan", async () => {
    prismaMock.dutyPlan.findFirst.mockResolvedValue({ id: "plan-1" });
    prismaMock.dutyPlanVersion.aggregate.mockResolvedValue({ _max: { versionNumber: 2 } });
    prismaMock.dutyPlanVersion.create.mockResolvedValue({ id: "version-3" });

    const result = await createPlanVersion({ organizationId: "org-1", planId: "plan-1", userId: "user-1" });

    expect(result).toEqual({ ok: true, versionId: "version-3", versionNumber: 3 });
    expect(prismaMock.dutyPlanVersion.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ versionNumber: 3, status: "DRAFT" }) })
    );
  });

  it("starts at version 1 when the plan has no versions yet", async () => {
    prismaMock.dutyPlan.findFirst.mockResolvedValue({ id: "plan-1" });
    prismaMock.dutyPlanVersion.aggregate.mockResolvedValue({ _max: { versionNumber: null } });
    prismaMock.dutyPlanVersion.create.mockResolvedValue({ id: "version-1" });

    const result = await createPlanVersion({ organizationId: "org-1", planId: "plan-1", userId: "user-1" });

    expect(result).toEqual({ ok: true, versionId: "version-1", versionNumber: 1 });
  });

  it("rejects a plan belonging to another organization", async () => {
    prismaMock.dutyPlan.findFirst.mockResolvedValue(null);

    const result = await createPlanVersion({
      organizationId: "org-1",
      planId: "plan-from-other-org",
      userId: "user-1",
    });

    expect(result).toEqual({ ok: false, code: "PLAN_NOT_FOUND", message: expect.any(String) });
    expect(prismaMock.dutyPlanVersion.create).not.toHaveBeenCalled();
  });
});
