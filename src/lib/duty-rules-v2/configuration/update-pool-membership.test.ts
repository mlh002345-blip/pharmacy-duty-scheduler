import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = {
  rotationPool: { findFirst: vi.fn() },
  pharmacy: { findFirst: vi.fn() },
  rotationPoolMembership: {
    findFirst: vi.fn(),
    create: vi.fn(),
    updateMany: vi.fn(),
    findMany: vi.fn(),
    update: vi.fn(),
  },
  auditLog: { create: vi.fn() },
  $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn(prismaMock)),
};

vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));

const { addPoolMembership, endPoolMembership, reorderPoolMemberships } = await import(
  "./update-pool-membership"
);

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => fn(prismaMock));
});

describe("addPoolMembership", () => {
  it("creates a membership on the happy path", async () => {
    prismaMock.rotationPool.findFirst.mockResolvedValue({ id: "pool-1", regionId: "region-1" });
    prismaMock.pharmacy.findFirst.mockResolvedValue({ id: "pharmacy-1" });
    prismaMock.rotationPoolMembership.findFirst.mockResolvedValue(null);
    prismaMock.rotationPoolMembership.create.mockResolvedValue({ id: "membership-1" });

    const result = await addPoolMembership({
      organizationId: "org-1",
      poolId: "pool-1",
      pharmacyId: "pharmacy-1",
      joinedAt: "2026-01-01",
      userId: "user-1",
    });

    expect(result).toEqual({ ok: true, membershipId: "membership-1" });
  });

  it("rejects a pool belonging to another organization", async () => {
    prismaMock.rotationPool.findFirst.mockResolvedValue(null);

    const result = await addPoolMembership({
      organizationId: "org-1",
      poolId: "pool-from-other-org",
      pharmacyId: "pharmacy-1",
      joinedAt: "2026-01-01",
      userId: "user-1",
    });

    expect(result).toEqual({ ok: false, code: "POOL_NOT_FOUND", message: expect.any(String) });
  });

  it("rejects a pharmacy that already has an open membership in this pool", async () => {
    prismaMock.rotationPool.findFirst.mockResolvedValue({ id: "pool-1", regionId: "region-1" });
    prismaMock.pharmacy.findFirst.mockResolvedValue({ id: "pharmacy-1" });
    prismaMock.rotationPoolMembership.findFirst.mockResolvedValue({ id: "existing-membership" });

    const result = await addPoolMembership({
      organizationId: "org-1",
      poolId: "pool-1",
      pharmacyId: "pharmacy-1",
      joinedAt: "2026-01-01",
      userId: "user-1",
    });

    expect(result).toEqual({ ok: false, code: "PHARMACY_ALREADY_MEMBER", message: expect.any(String) });
    expect(prismaMock.rotationPoolMembership.create).not.toHaveBeenCalled();
  });
});

describe("endPoolMembership", () => {
  it("closes an open membership on the happy path", async () => {
    prismaMock.rotationPoolMembership.findFirst.mockResolvedValue({
      id: "membership-1",
      leftAt: null,
      poolId: "pool-1",
      pharmacyId: "pharmacy-1",
    });
    prismaMock.rotationPoolMembership.updateMany.mockResolvedValue({ count: 1 });

    const result = await endPoolMembership({
      organizationId: "org-1",
      membershipId: "membership-1",
      leftAt: "2026-02-01",
      userId: "user-1",
    });

    expect(result).toEqual({ ok: true });
  });

  it("rejects closing an already-closed membership", async () => {
    prismaMock.rotationPoolMembership.findFirst.mockResolvedValue({
      id: "membership-1",
      leftAt: new Date("2026-01-15"),
    });

    const result = await endPoolMembership({
      organizationId: "org-1",
      membershipId: "membership-1",
      leftAt: "2026-02-01",
      userId: "user-1",
    });

    expect(result).toEqual({ ok: false, code: "ALREADY_CLOSED", message: expect.any(String) });
    expect(prismaMock.rotationPoolMembership.updateMany).not.toHaveBeenCalled();
  });

  it("rejects a membership belonging to another organization's pool", async () => {
    prismaMock.rotationPoolMembership.findFirst.mockResolvedValue(null);

    const result = await endPoolMembership({
      organizationId: "org-1",
      membershipId: "membership-from-other-org",
      leftAt: "2026-02-01",
      userId: "user-1",
    });

    expect(result).toEqual({ ok: false, code: "MEMBERSHIP_NOT_FOUND", message: expect.any(String) });
  });
});

describe("reorderPoolMemberships", () => {
  it("sets sortIndex 0..N-1 in the given order", async () => {
    prismaMock.rotationPool.findFirst.mockResolvedValue({ id: "pool-1" });
    prismaMock.rotationPoolMembership.findMany.mockResolvedValue([
      { id: "m1" },
      { id: "m2" },
    ]);

    const result = await reorderPoolMemberships({
      organizationId: "org-1",
      poolId: "pool-1",
      orderedMembershipIds: ["m2", "m1"],
      userId: "user-1",
    });

    expect(result).toEqual({ ok: true, count: 2 });
    expect(prismaMock.rotationPoolMembership.update).toHaveBeenNthCalledWith(1, {
      where: { id: "m2" },
      data: { sortIndex: 0 },
    });
    expect(prismaMock.rotationPoolMembership.update).toHaveBeenNthCalledWith(2, {
      where: { id: "m1" },
      data: { sortIndex: 1 },
    });
  });
});
