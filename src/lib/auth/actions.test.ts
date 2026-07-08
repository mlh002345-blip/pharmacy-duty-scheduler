import { beforeEach, describe, expect, it, vi } from "vitest";

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
