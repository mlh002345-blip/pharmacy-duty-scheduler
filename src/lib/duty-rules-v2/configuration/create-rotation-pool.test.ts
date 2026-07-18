import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";

const prismaMock = {
  region: { findFirst: vi.fn() },
  rotationPool: { create: vi.fn() },
  auditLog: { create: vi.fn() },
  $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn(prismaMock)),
};

vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));

const { createRotationPool } = await import("./create-rotation-pool");

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => fn(prismaMock));
});

describe("createRotationPool", () => {
  it("creates a pool on the happy path", async () => {
    prismaMock.region.findFirst.mockResolvedValue({ id: "region-1" });
    prismaMock.rotationPool.create.mockResolvedValue({ id: "pool-1" });

    const result = await createRotationPool({
      organizationId: "org-1",
      regionId: "region-1",
      name: "Cumartesi Havuzu",
      strategy: "SEQUENTIAL",
      userId: "user-1",
    });

    expect(result).toEqual({ ok: true, poolId: "pool-1" });
  });

  it("rejects a region belonging to another organization", async () => {
    prismaMock.region.findFirst.mockResolvedValue(null);

    const result = await createRotationPool({
      organizationId: "org-1",
      regionId: "region-from-other-org",
      name: "Havuz",
      strategy: "SEQUENTIAL",
      userId: "user-1",
    });

    expect(result).toEqual({ ok: false, code: "REGION_NOT_FOUND", message: expect.any(String) });
  });

  it("maps a P2002 unique-constraint violation on (organizationId, name) to a typed POOL_NAME_TAKEN error", async () => {
    prismaMock.region.findFirst.mockResolvedValue({ id: "region-1" });
    prismaMock.$transaction.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
        code: "P2002",
        clientVersion: "test",
        meta: { target: ["organizationId", "name"] },
      })
    );

    const result = await createRotationPool({
      organizationId: "org-1",
      regionId: "region-1",
      name: "Var Olan Havuz",
      strategy: "SEQUENTIAL",
      userId: "user-1",
    });

    expect(result).toEqual({ ok: false, code: "POOL_NAME_TAKEN", message: expect.any(String) });
  });
});
