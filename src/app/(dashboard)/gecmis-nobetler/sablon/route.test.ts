import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = {
  pharmacy: { findMany: vi.fn() },
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

const { GET } = await import("./route");

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.pharmacy.findMany.mockResolvedValue([]);
});

describe("GET /gecmis-nobetler/sablon — manageSetupData required", () => {
  it("VIEWER cannot download the template (403)", async () => {
    getCurrentUser.mockResolvedValue({ id: "viewer-1", role: "VIEWER" });

    const response = await GET();

    expect(response.status).toBe(403);
    expect(prismaMock.pharmacy.findMany).not.toHaveBeenCalled();
  });

  it("STAFF can download the template", async () => {
    getCurrentUser.mockResolvedValue({ id: "staff-1", role: "STAFF" });

    const response = await GET();

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toContain("spreadsheetml");
  });

  it("ADMIN can download the template", async () => {
    getCurrentUser.mockResolvedValue({ id: "admin-1", role: "ADMIN" });

    const response = await GET();

    expect(response.status).toBe(200);
  });

  it("unauthenticated request redirects to /giris", async () => {
    getCurrentUser.mockResolvedValue(null);

    await expect(GET()).rejects.toThrow("REDIRECT:/giris");
  });
});
