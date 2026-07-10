import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getCurrentUser = vi.fn();
const redirect = vi.fn((path: string) => {
  throw new Error(`REDIRECT:${path}`);
});
const redirectWithMessage = vi.fn(
  (path: string, kind: "success" | "error", message: string) => {
    throw new Error(`FLASH_REDIRECT:${path}:${kind}:${message}`);
  }
);

vi.mock("./session", () => ({
  getCurrentUser: (...args: unknown[]) => getCurrentUser(...args),
}));
vi.mock("next/navigation", () => ({
  redirect: (...args: [string]) => redirect(...args),
}));
vi.mock("@/lib/flash-redirect", () => ({
  redirectWithMessage: (...args: [string, "success" | "error", string]) =>
    redirectWithMessage(...args),
}));

const { requirePermissionOrState, requirePermissionOrRedirectWithMessage, UNAUTHORIZED_MESSAGE } =
  await import("./guard");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("requirePermissionOrState — authorization_denied logging", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it("logs authorization_denied at warn level with userId and requiredPermission when the role lacks permission", async () => {
    getCurrentUser.mockResolvedValue({ id: "u1", role: "VIEWER" });

    const result = await requirePermissionOrState("manageSetupData");

    expect(result).toEqual({
      user: null,
      state: { success: false, message: UNAUTHORIZED_MESSAGE },
    });
    expect(warnSpy).toHaveBeenCalledOnce();
    const record = JSON.parse(warnSpy.mock.calls[0][0] as string);
    expect(record.event).toBe("authorization_denied");
    expect(record.level).toBe("warn");
    expect(record.userId).toBe("u1");
    expect(record.requiredPermission).toBe("manageSetupData");
  });

  it("does not log when the user has the required permission", async () => {
    getCurrentUser.mockResolvedValue({ id: "u1", role: "ADMIN" });

    await requirePermissionOrState("manageSetupData");

    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("does not log for an unauthenticated (no-session) redirect — that's just 'not logged in', not a denial", async () => {
    getCurrentUser.mockResolvedValue(null);

    await expect(requirePermissionOrState("manageSetupData")).rejects.toThrow("REDIRECT:/giris");

    expect(warnSpy).not.toHaveBeenCalled();
  });
});

describe("requirePermissionOrRedirectWithMessage — authorization_denied logging", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it("logs authorization_denied including the safe redirect path before redirecting", async () => {
    getCurrentUser.mockResolvedValue({ id: "u2", role: "STAFF" });

    await expect(
      requirePermissionOrRedirectWithMessage("deleteSetupData", "/eczaneler", "Yetkiniz yok.")
    ).rejects.toThrow("FLASH_REDIRECT:/eczaneler:error:Yetkiniz yok.");

    expect(warnSpy).toHaveBeenCalledOnce();
    const record = JSON.parse(warnSpy.mock.calls[0][0] as string);
    expect(record.event).toBe("authorization_denied");
    expect(record.userId).toBe("u2");
    expect(record.requiredPermission).toBe("deleteSetupData");
    expect(record.redirectPath).toBe("/eczaneler");
  });
});
