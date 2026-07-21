import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = {
  user: { findUnique: vi.fn() },
};
const verifyPassword = vi.fn();
const createSession = vi.fn();
const redirect = vi.fn((path: string) => {
  throw new Error(`REDIRECT:${path}`);
});
const getClientIdentity = vi.fn();
const checkLoginRateLimit = vi.fn();
const recordLoginFailure = vi.fn();
const clearAccountLoginRateLimit = vi.fn();

vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));
vi.mock("./password", () => ({
  verifyPassword: (...args: unknown[]) => verifyPassword(...args),
}));
vi.mock("./session", () => ({
  createSession: (...args: unknown[]) => createSession(...args),
  destroySession: vi.fn(),
}));
vi.mock("@/lib/security/client-identity", () => ({
  getClientIdentity: (...args: unknown[]) => getClientIdentity(...args),
}));
vi.mock("./login-rate-limit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./login-rate-limit")>();
  return {
    ...actual,
    checkLoginRateLimit: (...args: unknown[]) => checkLoginRateLimit(...args),
    recordLoginFailure: (...args: unknown[]) => recordLoginFailure(...args),
    clearAccountLoginRateLimit: (...args: unknown[]) => clearAccountLoginRateLimit(...args),
  };
});
vi.mock("next/navigation", () => ({
  redirect: (...args: [string]) => redirect(...args),
}));

const { loginAction } = await import("./actions");

const GENERIC_MESSAGE = "Hatalı e-posta veya şifre.";
const RATE_LIMIT_MESSAGE =
  "Çok fazla başarısız giriş denemesi yapıldı. Lütfen bir süre sonra tekrar deneyin.";

function makeFormData(email: string, password: string): FormData {
  const fd = new FormData();
  fd.set("email", email);
  fd.set("password", password);
  return fd;
}

beforeEach(() => {
  vi.clearAllMocks();
  getClientIdentity.mockResolvedValue({ networkBucketKey: "network-hash", trusted: false });
  checkLoginRateLimit.mockResolvedValue({ blocked: false });
  recordLoginFailure.mockResolvedValue({ blocked: false });
  clearAccountLoginRateLimit.mockResolvedValue(undefined);
});

describe("loginAction — no account-status enumeration", () => {
  it("returns the generic message for a nonexistent email", async () => {
    prismaMock.user.findUnique.mockResolvedValue(null);

    const result = await loginAction(
      { success: false, message: "" },
      makeFormData("nobody@example.com", "whatever")
    );

    expect(result).toEqual({ success: false, message: GENERIC_MESSAGE });
    expect(verifyPassword).not.toHaveBeenCalled();
    expect(recordLoginFailure).toHaveBeenCalledOnce();
  });

  it("returns the generic message for a wrong password on an existing, active account", async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      id: "u1",
      passwordHash: "hash",
      isActive: true,
    });
    verifyPassword.mockResolvedValue(false);

    const result = await loginAction(
      { success: false, message: "" },
      makeFormData("real@example.com", "wrong-password")
    );

    expect(result).toEqual({ success: false, message: GENERIC_MESSAGE });
  });

  it("returns the SAME generic message (not a distinct one) for a correct password on an inactive account", async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      id: "u1",
      passwordHash: "hash",
      isActive: false,
    });
    verifyPassword.mockResolvedValue(true);

    const result = await loginAction(
      { success: false, message: "" },
      makeFormData("inactive@example.com", "correct-password")
    );

    expect(result).toEqual({ success: false, message: GENERIC_MESSAGE });
    expect(createSession).not.toHaveBeenCalled();
    // Same external behavior as any other credential failure: counted by
    // the rate limiter exactly like a wrong password would be.
    expect(recordLoginFailure).toHaveBeenCalledOnce();
  });

  it("all three failure messages are textually identical", async () => {
    prismaMock.user.findUnique.mockResolvedValueOnce(null);
    const noAccount = await loginAction(
      { success: false, message: "" },
      makeFormData("a@example.com", "x")
    );

    prismaMock.user.findUnique.mockResolvedValueOnce({
      id: "u1",
      passwordHash: "hash",
      isActive: true,
    });
    verifyPassword.mockResolvedValueOnce(false);
    const wrongPassword = await loginAction(
      { success: false, message: "" },
      makeFormData("b@example.com", "x")
    );

    prismaMock.user.findUnique.mockResolvedValueOnce({
      id: "u1",
      passwordHash: "hash",
      isActive: false,
    });
    verifyPassword.mockResolvedValueOnce(true);
    const inactive = await loginAction(
      { success: false, message: "" },
      makeFormData("c@example.com", "x")
    );

    expect(noAccount.message).toBe(wrongPassword.message);
    expect(wrongPassword.message).toBe(inactive.message);
  });

  it("still creates a session and redirects for a correct password on an active account", async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      id: "u1",
      passwordHash: "hash",
      isActive: true,
    });
    verifyPassword.mockResolvedValue(true);

    await expect(
      loginAction({ success: false, message: "" }, makeFormData("real@example.com", "correct"))
    ).rejects.toThrow("REDIRECT:/panel");

    expect(createSession).toHaveBeenCalledExactlyOnceWith("u1");
    expect(clearAccountLoginRateLimit).toHaveBeenCalledOnce();
    expect(recordLoginFailure).not.toHaveBeenCalled();
  });

  it("does not check or record rate limiting for a validation (zod) failure", async () => {
    const result = await loginAction(
      { success: false, message: "" },
      makeFormData("not-an-email", "")
    );

    expect(result.success).toBe(false);
    expect(checkLoginRateLimit).not.toHaveBeenCalled();
    expect(recordLoginFailure).not.toHaveBeenCalled();
    expect(prismaMock.user.findUnique).not.toHaveBeenCalled();
  });
});

describe("loginAction — rate limiting", () => {
  it("returns the neutral rate-limit message and never touches the database when already blocked", async () => {
    checkLoginRateLimit.mockResolvedValue({
      blocked: true,
      dimension: "ACCOUNT",
      retryAfterSeconds: 600,
    });

    const result = await loginAction(
      { success: false, message: "" },
      makeFormData("someone@example.com", "whatever")
    );

    expect(result).toEqual({ success: false, message: RATE_LIMIT_MESSAGE });
    expect(prismaMock.user.findUnique).not.toHaveBeenCalled();
    expect(verifyPassword).not.toHaveBeenCalled();
  });

  it("returns the neutral rate-limit message even for a request that would otherwise be a nonexistent account (no enumeration)", async () => {
    checkLoginRateLimit.mockResolvedValue({
      blocked: true,
      dimension: "NETWORK",
      retryAfterSeconds: 300,
    });

    const result = await loginAction(
      { success: false, message: "" },
      makeFormData("nobody-at-all@example.com", "whatever")
    );

    expect(result.message).toBe(RATE_LIMIT_MESSAGE);
    expect(result.message).not.toContain("nobody-at-all@example.com");
  });

  it("records a failure for every credential attempt path, including inactive accounts", async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      id: "u1",
      passwordHash: "hash",
      isActive: false,
    });
    verifyPassword.mockResolvedValue(true);

    await loginAction(
      { success: false, message: "" },
      makeFormData("inactive@example.com", "correct-password")
    );

    expect(recordLoginFailure).toHaveBeenCalledExactlyOnceWith({
      networkBucketKey: "network-hash",
      accountBucketKey: expect.any(String),
    });
  });
});

describe("loginAction — auth_login_failed / auth_login_succeeded / auth_login_rate_limited logging", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let infoSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
    infoSpy.mockRestore();
  });

  it("logs auth_login_failed at warn level for a nonexistent email, without the email or password", async () => {
    prismaMock.user.findUnique.mockResolvedValue(null);

    await loginAction(
      { success: false, message: "" },
      makeFormData("nobody@example.com", "super-secret-password")
    );

    expect(warnSpy).toHaveBeenCalledOnce();
    const line = warnSpy.mock.calls[0][0] as string;
    const record = JSON.parse(line);
    expect(record.event).toBe("auth_login_failed");
    expect(record.level).toBe("warn");
    expect(record.reason).toBe("unknown_account");
    expect(line).not.toContain("nobody@example.com");
    expect(line).not.toContain("super-secret-password");
  });

  it("logs auth_login_failed with reason invalid_password, without the password", async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      id: "u1",
      passwordHash: "hash",
      isActive: true,
    });
    verifyPassword.mockResolvedValue(false);

    await loginAction(
      { success: false, message: "" },
      makeFormData("real@example.com", "wrong-password-value")
    );

    const record = JSON.parse(warnSpy.mock.calls[0][0] as string);
    expect(record.reason).toBe("invalid_password");
    expect(warnSpy.mock.calls[0][0]).not.toContain("wrong-password-value");
    expect(warnSpy.mock.calls[0][0]).not.toContain("real@example.com");
  });

  it("logs auth_login_failed with reason inactive_account", async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      id: "u1",
      passwordHash: "hash",
      isActive: false,
    });
    verifyPassword.mockResolvedValue(true);

    await loginAction(
      { success: false, message: "" },
      makeFormData("inactive@example.com", "correct-password")
    );

    const record = JSON.parse(warnSpy.mock.calls[0][0] as string);
    expect(record.reason).toBe("inactive_account");
  });

  it("logs auth_login_succeeded at info level with userId, not email, on success", async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      id: "u1",
      passwordHash: "hash",
      isActive: true,
    });
    verifyPassword.mockResolvedValue(true);

    await expect(
      loginAction({ success: false, message: "" }, makeFormData("real@example.com", "correct"))
    ).rejects.toThrow("REDIRECT:/panel");

    expect(infoSpy).toHaveBeenCalledOnce();
    const record = JSON.parse(infoSpy.mock.calls[0][0] as string);
    expect(record.event).toBe("auth_login_succeeded");
    expect(record.userId).toBe("u1");
    expect(infoSpy.mock.calls[0][0]).not.toContain("real@example.com");
  });

  it("logs auth_login_rate_limited with requestId/dimension/retryAfterSeconds, never email or password", async () => {
    checkLoginRateLimit.mockResolvedValue({
      blocked: true,
      dimension: "ACCOUNT",
      retryAfterSeconds: 42,
    });

    await loginAction(
      { success: false, message: "" },
      makeFormData("someone@example.com", "super-secret-password")
    );

    expect(warnSpy).toHaveBeenCalledOnce();
    const line = warnSpy.mock.calls[0][0] as string;
    const record = JSON.parse(line);
    expect(record.event).toBe("auth_login_rate_limited");
    expect(record.dimension).toBe("ACCOUNT");
    expect(record.retryAfterSeconds).toBe(42);
    expect(line).not.toContain("someone@example.com");
    expect(line).not.toContain("super-secret-password");
  });

  it("logs auth_login_rate_limited when a credential attempt itself crosses the threshold", async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      id: "u1",
      passwordHash: "hash",
      isActive: true,
    });
    verifyPassword.mockResolvedValue(false);
    recordLoginFailure.mockResolvedValue({
      blocked: true,
      dimension: "NETWORK",
      retryAfterSeconds: 900,
    });

    await loginAction(
      { success: false, message: "" },
      makeFormData("real@example.com", "wrong-password")
    );

    const events = warnSpy.mock.calls.map((call: unknown[]) => JSON.parse(call[0] as string).event);
    expect(events).toContain("auth_login_failed");
    expect(events).toContain("auth_login_rate_limited");
  });
});
