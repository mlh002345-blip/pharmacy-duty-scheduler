import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = {
  user: { findUnique: vi.fn() },
};
const verifyPassword = vi.fn();
const createSession = vi.fn();
const redirect = vi.fn((path: string) => {
  throw new Error(`REDIRECT:${path}`);
});

vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));
vi.mock("./password", () => ({
  verifyPassword: (...args: unknown[]) => verifyPassword(...args),
}));
vi.mock("./session", () => ({
  createSession: (...args: unknown[]) => createSession(...args),
  destroySession: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  redirect: (...args: [string]) => redirect(...args),
}));

const { loginAction } = await import("./actions");

const GENERIC_MESSAGE = "Hatalı e-posta veya şifre.";

function makeFormData(email: string, password: string): FormData {
  const fd = new FormData();
  fd.set("email", email);
  fd.set("password", password);
  return fd;
}

beforeEach(() => {
  vi.clearAllMocks();
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
    ).rejects.toThrow("REDIRECT:/");

    expect(createSession).toHaveBeenCalledExactlyOnceWith("u1");
  });
});

describe("loginAction — auth_login_failed / auth_login_succeeded logging", () => {
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
    ).rejects.toThrow("REDIRECT:/");

    expect(infoSpy).toHaveBeenCalledOnce();
    const record = JSON.parse(infoSpy.mock.calls[0][0] as string);
    expect(record.event).toBe("auth_login_succeeded");
    expect(record.userId).toBe("u1");
    expect(infoSpy.mock.calls[0][0]).not.toContain("real@example.com");
  });
});
