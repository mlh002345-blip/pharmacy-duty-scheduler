import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = {
  loginAttempt: {
    findMany: vi.fn(),
    updateMany: vi.fn(),
    deleteMany: vi.fn(),
  },
  $queryRaw: vi.fn(),
};

vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));

const {
  checkLoginRateLimit,
  recordLoginFailure,
  clearAccountLoginRateLimit,
  hashAccountIdentifier,
  MAX_FAILED_ATTEMPTS,
} = await import("./login-rate-limit");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("hashAccountIdentifier", () => {
  it("normalizes case and whitespace before hashing", () => {
    expect(hashAccountIdentifier("  User@Example.com  ")).toBe(
      hashAccountIdentifier("user@example.com")
    );
  });

  it("returns a SHA-256 hex digest, never the raw email", () => {
    const digest = hashAccountIdentifier("someone@example.com");
    expect(digest).toMatch(/^[a-f0-9]{64}$/);
    expect(digest).not.toContain("someone");
    expect(digest).not.toContain("example.com");
  });

  it("different emails hash to different digests", () => {
    expect(hashAccountIdentifier("a@example.com")).not.toBe(hashAccountIdentifier("b@example.com"));
  });
});

describe("checkLoginRateLimit", () => {
  it("returns not blocked when no rows exist", async () => {
    prismaMock.loginAttempt.findMany.mockResolvedValue([]);

    const result = await checkLoginRateLimit({
      networkBucketKey: "net",
      accountBucketKey: "acct",
    });

    expect(result).toEqual({ blocked: false });
  });

  it("returns not blocked when blockedUntil is in the past", async () => {
    prismaMock.loginAttempt.findMany.mockResolvedValue([
      { bucketType: "ACCOUNT", blockedUntil: new Date(Date.now() - 1000) },
    ]);

    const result = await checkLoginRateLimit({
      networkBucketKey: "net",
      accountBucketKey: "acct",
    });

    expect(result).toEqual({ blocked: false });
  });

  it("returns blocked with the account dimension and a positive retryAfterSeconds", async () => {
    prismaMock.loginAttempt.findMany.mockResolvedValue([
      { bucketType: "ACCOUNT", blockedUntil: new Date(Date.now() + 60_000) },
    ]);

    const result = await checkLoginRateLimit({
      networkBucketKey: "net",
      accountBucketKey: "acct",
    });

    expect(result.blocked).toBe(true);
    if (result.blocked) {
      expect(result.dimension).toBe("ACCOUNT");
      expect(result.retryAfterSeconds).toBeGreaterThan(0);
    }
  });

  it("prefers the account dimension when both are blocked", async () => {
    const future = new Date(Date.now() + 60_000);
    prismaMock.loginAttempt.findMany.mockResolvedValue([
      { bucketType: "NETWORK", blockedUntil: future },
      { bucketType: "ACCOUNT", blockedUntil: future },
    ]);

    const result = await checkLoginRateLimit({
      networkBucketKey: "net",
      accountBucketKey: "acct",
    });

    expect(result.blocked).toBe(true);
    if (result.blocked) expect(result.dimension).toBe("ACCOUNT");
  });

  it("queries both dimensions by (bucketType, bucketKey)", async () => {
    prismaMock.loginAttempt.findMany.mockResolvedValue([]);

    await checkLoginRateLimit({ networkBucketKey: "net-key", accountBucketKey: "acct-key" });

    expect(prismaMock.loginAttempt.findMany).toHaveBeenCalledExactlyOnceWith({
      where: {
        OR: [
          { bucketType: "NETWORK", bucketKey: "net-key" },
          { bucketType: "ACCOUNT", bucketKey: "acct-key" },
        ],
      },
      select: { bucketType: true, blockedUntil: true },
    });
  });
});

describe("recordLoginFailure", () => {
  it("increments both dimensions via the atomic upsert, not a separate read-then-write", async () => {
    prismaMock.$queryRaw.mockResolvedValue([{ failureCount: 1, blockedUntil: null }]);

    await recordLoginFailure({ networkBucketKey: "net", accountBucketKey: "acct" });

    // Two atomic upserts (one per dimension) — never a findFirst/find-then-create.
    expect(prismaMock.$queryRaw).toHaveBeenCalledTimes(2);
  });

  it("does not report blocked below the threshold", async () => {
    prismaMock.$queryRaw.mockResolvedValue([
      { failureCount: MAX_FAILED_ATTEMPTS - 1, blockedUntil: null },
    ]);

    const result = await recordLoginFailure({ networkBucketKey: "net", accountBucketKey: "acct" });

    expect(result).toEqual({ blocked: false });
    expect(prismaMock.loginAttempt.updateMany).not.toHaveBeenCalled();
  });

  it("applies the block once the account dimension reaches the threshold", async () => {
    prismaMock.$queryRaw
      .mockResolvedValueOnce([{ failureCount: 1, blockedUntil: null }]) // NETWORK
      .mockResolvedValueOnce([{ failureCount: MAX_FAILED_ATTEMPTS, blockedUntil: null }]); // ACCOUNT
    prismaMock.loginAttempt.updateMany.mockResolvedValue({ count: 1 });

    const result = await recordLoginFailure({ networkBucketKey: "net", accountBucketKey: "acct" });

    expect(result.blocked).toBe(true);
    if (result.blocked) {
      expect(result.dimension).toBe("ACCOUNT");
      expect(result.retryAfterSeconds).toBeGreaterThan(0);
    }
  });

  it("reports blocked even if the block-setting updateMany affects zero rows (already set by a concurrent call)", async () => {
    prismaMock.$queryRaw
      .mockResolvedValueOnce([{ failureCount: MAX_FAILED_ATTEMPTS + 1, blockedUntil: null }]) // NETWORK
      .mockResolvedValueOnce([{ failureCount: 1, blockedUntil: null }]); // ACCOUNT
    prismaMock.loginAttempt.updateMany.mockResolvedValue({ count: 0 });

    const result = await recordLoginFailure({ networkBucketKey: "net", accountBucketKey: "acct" });

    expect(result.blocked).toBe(true);
    if (result.blocked) expect(result.dimension).toBe("NETWORK");
  });

  it("treats a still-active blockedUntil returned by the upsert as already blocked, without an extra write", async () => {
    const future = new Date(Date.now() + 60_000);
    prismaMock.$queryRaw
      .mockResolvedValueOnce([{ failureCount: 8, blockedUntil: future }]) // NETWORK already blocked
      .mockResolvedValueOnce([{ failureCount: 1, blockedUntil: null }]); // ACCOUNT

    const result = await recordLoginFailure({ networkBucketKey: "net", accountBucketKey: "acct" });

    expect(result.blocked).toBe(true);
    if (result.blocked) expect(result.dimension).toBe("NETWORK");
    // Already blocked (per the upsert's own RETURNING) — no redundant updateMany needed for that dimension.
    expect(prismaMock.loginAttempt.updateMany).not.toHaveBeenCalled();
  });
});

describe("clearAccountLoginRateLimit", () => {
  it("deletes only the ACCOUNT-dimension row for the given key, never NETWORK", async () => {
    await clearAccountLoginRateLimit("acct-key");

    expect(prismaMock.loginAttempt.deleteMany).toHaveBeenCalledExactlyOnceWith({
      where: { bucketType: "ACCOUNT", bucketKey: "acct-key" },
    });
  });
});
