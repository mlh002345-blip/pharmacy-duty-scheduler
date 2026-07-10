import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = {
  session: {
    create: vi.fn(),
    deleteMany: vi.fn(),
    findUnique: vi.fn(),
  },
};

const cookieStoreMock = {
  get: vi.fn(),
  set: vi.fn(),
  delete: vi.fn(),
};

const cookies: (...args: unknown[]) => Promise<typeof cookieStoreMock> = vi.fn(
  async () => cookieStoreMock
);
const redirect = vi.fn((path: string) => {
  throw new Error(`REDIRECT:${path}`);
});

vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));
vi.mock("next/headers", () => ({
  cookies: (...args: unknown[]) => cookies(...args),
}));
vi.mock("next/navigation", () => ({
  redirect: (...args: [string]) => redirect(...args),
}));

const {
  createSession,
  destroySession,
  invalidateUserSessions,
  clearSessionCookie,
  getCurrentUser,
  requireUser,
} = await import("./session");

function activeUser(overrides: Partial<Record<string, unknown>> = {}) {
  return { id: "user-1", isActive: true, role: "STAFF", ...overrides };
}

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.session.deleteMany.mockResolvedValue({ count: 0 });
});

describe("getCurrentUser — session validation", () => {
  it("returns the user for a valid, unexpired session belonging to an active user", async () => {
    const now = new Date("2026-07-10T12:00:00.000Z");
    vi.useFakeTimers();
    vi.setSystemTime(now);

    cookieStoreMock.get.mockReturnValue({ value: "valid-token" });
    prismaMock.session.findUnique.mockResolvedValue({
      token: "valid-token",
      expiresAt: new Date(now.getTime() + 1000),
      user: activeUser(),
    });

    const user = await getCurrentUser();

    expect(user).toEqual(activeUser());
    expect(prismaMock.session.findUnique).toHaveBeenCalledExactlyOnceWith({
      where: { token: "valid-token" },
      include: { user: true },
    });

    vi.useRealTimers();
  });

  it("returns null for a missing token, without querying the database", async () => {
    cookieStoreMock.get.mockReturnValue(undefined);

    const user = await getCurrentUser();

    expect(user).toBeNull();
    expect(prismaMock.session.findUnique).not.toHaveBeenCalled();
  });

  it("returns null when no session row matches the token", async () => {
    cookieStoreMock.get.mockReturnValue({ value: "unknown-token" });
    prismaMock.session.findUnique.mockResolvedValue(null);

    const user = await getCurrentUser();

    expect(user).toBeNull();
  });

  it("returns null for a session that expired 1ms ago", async () => {
    const now = new Date("2026-07-10T12:00:00.000Z");
    vi.useFakeTimers();
    vi.setSystemTime(now);

    cookieStoreMock.get.mockReturnValue({ value: "expired-token" });
    prismaMock.session.findUnique.mockResolvedValue({
      token: "expired-token",
      expiresAt: new Date(now.getTime() - 1),
      user: activeUser(),
    });

    const user = await getCurrentUser();

    expect(user).toBeNull();

    vi.useRealTimers();
  });

  it("boundary: a session whose expiresAt equals the current instant exactly is still accepted (strict less-than expiry check)", async () => {
    // getCurrentUser rejects only when expiresAt.getTime() < Date.now();
    // this pins down the exact-tie behavior so a future flip to `<=`
    // (which would reject a session at the instant it expires, one tick
    // earlier than today) is a visible, deliberate change, not a silent one.
    const now = new Date("2026-07-10T12:00:00.000Z");
    vi.useFakeTimers();
    vi.setSystemTime(now);

    cookieStoreMock.get.mockReturnValue({ value: "boundary-token" });
    prismaMock.session.findUnique.mockResolvedValue({
      token: "boundary-token",
      expiresAt: new Date(now.getTime()),
      user: activeUser(),
    });

    const user = await getCurrentUser();

    expect(user).not.toBeNull();

    vi.useRealTimers();
  });

  it("returns null for a technically-valid, unexpired session belonging to a deactivated user", async () => {
    const now = new Date("2026-07-10T12:00:00.000Z");
    vi.useFakeTimers();
    vi.setSystemTime(now);

    cookieStoreMock.get.mockReturnValue({ value: "valid-token" });
    prismaMock.session.findUnique.mockResolvedValue({
      token: "valid-token",
      expiresAt: new Date(now.getTime() + 1000),
      user: activeUser({ isActive: false }),
    });

    const user = await getCurrentUser();

    expect(user).toBeNull();

    vi.useRealTimers();
  });

  it("does not delete the expired session row itself — expiry is a read-time check, not a cleanup job", async () => {
    // Documents current behavior precisely: getCurrentUser never calls
    // session.deleteMany for an expired-but-still-present row. If cleanup
    // is ever added, this test should be updated deliberately rather than
    // silently start passing/failing.
    const now = new Date("2026-07-10T12:00:00.000Z");
    vi.useFakeTimers();
    vi.setSystemTime(now);

    cookieStoreMock.get.mockReturnValue({ value: "expired-token" });
    prismaMock.session.findUnique.mockResolvedValue({
      token: "expired-token",
      expiresAt: new Date(now.getTime() - 1),
      user: activeUser(),
    });

    await getCurrentUser();

    expect(prismaMock.session.deleteMany).not.toHaveBeenCalled();

    vi.useRealTimers();
  });
});

describe("requireUser — redirects when there is no valid session", () => {
  it("returns the user when a valid session exists", async () => {
    cookieStoreMock.get.mockReturnValue({ value: "valid-token" });
    prismaMock.session.findUnique.mockResolvedValue({
      token: "valid-token",
      expiresAt: new Date(Date.now() + 60_000),
      user: activeUser(),
    });

    const user = await requireUser();

    expect(user).toEqual(activeUser());
    expect(redirect).not.toHaveBeenCalled();
  });

  it("redirects to /giris when there is no valid session", async () => {
    cookieStoreMock.get.mockReturnValue(undefined);

    await expect(requireUser()).rejects.toThrow("REDIRECT:/giris");
  });
});

describe("destroySession — idempotent", () => {
  it("deletes the session row matching the cookie token and clears the cookie", async () => {
    cookieStoreMock.get.mockReturnValue({ value: "some-token" });

    await destroySession();

    expect(prismaMock.session.deleteMany).toHaveBeenCalledExactlyOnceWith({
      where: { token: "some-token" },
    });
    expect(cookieStoreMock.delete).toHaveBeenCalledExactlyOnceWith("session_token");
  });

  it("calling it twice in a row does not throw and only issues DB deletes for a present token each time", async () => {
    cookieStoreMock.get.mockReturnValue({ value: "some-token" });

    await destroySession();
    await destroySession();

    expect(prismaMock.session.deleteMany).toHaveBeenCalledTimes(2);
  });

  it("with no cookie present, does not attempt a database delete but still clears the cookie", async () => {
    cookieStoreMock.get.mockReturnValue(undefined);

    await destroySession();

    expect(prismaMock.session.deleteMany).not.toHaveBeenCalled();
    expect(cookieStoreMock.delete).toHaveBeenCalledExactlyOnceWith("session_token");
  });
});

describe("invalidateUserSessions — idempotent", () => {
  it("deletes all sessions for the given user", async () => {
    await invalidateUserSessions("user-1");

    expect(prismaMock.session.deleteMany).toHaveBeenCalledExactlyOnceWith({
      where: { userId: "user-1" },
    });
  });

  it("calling it twice for a user with no remaining sessions does not throw (deleteMany over zero rows is a no-op)", async () => {
    prismaMock.session.deleteMany.mockResolvedValue({ count: 0 });

    await invalidateUserSessions("user-1");
    await expect(invalidateUserSessions("user-1")).resolves.not.toThrow();

    expect(prismaMock.session.deleteMany).toHaveBeenCalledTimes(2);
  });

  it("accepts an injected transaction client instead of the default prisma client", async () => {
    const txMock = { session: { deleteMany: vi.fn().mockResolvedValue({ count: 1 }) } };

    await invalidateUserSessions(
      "user-1",
      txMock as unknown as Parameters<typeof invalidateUserSessions>[1]
    );

    expect(txMock.session.deleteMany).toHaveBeenCalledExactlyOnceWith({
      where: { userId: "user-1" },
    });
    expect(prismaMock.session.deleteMany).not.toHaveBeenCalled();
  });
});

describe("createSession", () => {
  it("creates a session row and sets a cookie with the same token", async () => {
    await createSession("user-1");

    expect(prismaMock.session.create).toHaveBeenCalledOnce();
    const createArgs = prismaMock.session.create.mock.calls[0][0];
    expect(createArgs.data.userId).toBe("user-1");
    expect(typeof createArgs.data.token).toBe("string");
    expect(createArgs.data.token.length).toBeGreaterThan(0);

    expect(cookieStoreMock.set).toHaveBeenCalledOnce();
    const [cookieName, cookieValue, cookieOptions] = cookieStoreMock.set.mock.calls[0];
    expect(cookieName).toBe("session_token");
    expect(cookieValue).toBe(createArgs.data.token);
    expect(cookieOptions.httpOnly).toBe(true);
    expect(cookieOptions.sameSite).toBe("lax");
  });

  it("generates a different token for each session (no fixture reuse)", async () => {
    await createSession("user-1");
    const firstToken = prismaMock.session.create.mock.calls[0][0].data.token;

    await createSession("user-1");
    const secondToken = prismaMock.session.create.mock.calls[1][0].data.token;

    expect(firstToken).not.toBe(secondToken);
  });
});

describe("clearSessionCookie", () => {
  it("deletes the session cookie without touching the database", async () => {
    await clearSessionCookie();

    expect(cookieStoreMock.delete).toHaveBeenCalledExactlyOnceWith("session_token");
    expect(prismaMock.session.deleteMany).not.toHaveBeenCalled();
  });
});

afterEach(() => {
  vi.useRealTimers();
});
