import { beforeEach, describe, expect, it, vi } from "vitest";

class RedirectSignal extends Error {
  constructor(
    public path: string,
    public kind: "success" | "error",
    public redirectMessage: string
  ) {
    super("REDIRECT");
  }
}

const prismaMock = {
  auditLog: { findMany: vi.fn(), count: vi.fn() },
};
const getCurrentUser = vi.fn();
const redirect = vi.fn((path: string) => {
  throw new Error(`REDIRECT:${path}`);
});

vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));
vi.mock("@/lib/auth/session", () => ({
  getCurrentUser: (...args: unknown[]) => getCurrentUser(...args),
}));
vi.mock("next/navigation", () => ({
  redirect: (...args: [string]) => redirect(...args),
}));
vi.mock("@/lib/flash-redirect", () => ({
  redirectWithMessage: (path: string, kind: "success" | "error", message: string) => {
    throw new RedirectSignal(path, kind, message);
  },
}));

const DenetimKayitlariPage = (await import("./page")).default;

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.auditLog.findMany.mockResolvedValue([]);
  prismaMock.auditLog.count.mockResolvedValue(0);
});

function searchParams() {
  return Promise.resolve({});
}

describe("DenetimKayitlariPage — manageUsers required", () => {
  it("VIEWER cannot access the audit log page", async () => {
    getCurrentUser.mockResolvedValue({ id: "viewer-1", role: "VIEWER" });

    await expect(DenetimKayitlariPage({ searchParams: searchParams() })).rejects.toBeInstanceOf(
      RedirectSignal
    );
    expect(prismaMock.auditLog.findMany).not.toHaveBeenCalled();
  });

  it("STAFF cannot access the audit log page", async () => {
    getCurrentUser.mockResolvedValue({ id: "staff-1", role: "STAFF" });

    await expect(DenetimKayitlariPage({ searchParams: searchParams() })).rejects.toBeInstanceOf(
      RedirectSignal
    );
    expect(prismaMock.auditLog.findMany).not.toHaveBeenCalled();
  });

  it("ADMIN can access the audit log page", async () => {
    getCurrentUser.mockResolvedValue({ id: "admin-1", role: "ADMIN" });

    await expect(
      DenetimKayitlariPage({ searchParams: searchParams() })
    ).resolves.toBeTruthy();
    expect(prismaMock.auditLog.findMany).toHaveBeenCalled();
  });

  it("unauthenticated request redirects to /giris", async () => {
    getCurrentUser.mockResolvedValue(null);

    await expect(DenetimKayitlariPage({ searchParams: searchParams() })).rejects.toThrow(
      "REDIRECT:/giris"
    );
  });
});
