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
  region: { findUnique: vi.fn(), delete: vi.fn() },
  pharmacy: { count: vi.fn() },
};
const writeAuditLog = vi.fn();
const revalidatePath = vi.fn();
const getCurrentUser = vi.fn();

vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));
vi.mock("@/lib/audit", () => ({
  writeAuditLog: (...args: unknown[]) => writeAuditLog(...args),
}));
vi.mock("next/cache", () => ({
  revalidatePath: (...args: unknown[]) => revalidatePath(...args),
}));
vi.mock("@/lib/flash-redirect", () => ({
  redirectWithMessage: (path: string, kind: "success" | "error", message: string) => {
    throw new RedirectSignal(path, kind, message);
  },
}));
// getCurrentUser is the only leaf mocked; requirePermissionOrRedirect and
// hasPermission run for real, so this exercises the actual role wiring.
vi.mock("@/lib/auth/session", () => ({
  getCurrentUser: (...args: unknown[]) => getCurrentUser(...args),
}));

const { deleteRegionAction } = await import("./actions");

function region(overrides: Partial<Record<string, unknown>> = {}) {
  return { id: "region-1", name: "Kadıköy", isActive: true, ...overrides };
}

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.pharmacy.count.mockResolvedValue(0); // no pharmacies blocking delete
});

describe("deleteRegionAction — deleteSetupData is ADMIN-only", () => {
  it("STAFF cannot delete a region", async () => {
    getCurrentUser.mockResolvedValue({ id: "staff-1", role: "STAFF" });
    prismaMock.region.findUnique.mockResolvedValue(region());

    await expect(deleteRegionAction("region-1")).rejects.toBeInstanceOf(RedirectSignal);

    expect(prismaMock.region.delete).not.toHaveBeenCalled();
  });

  it("VIEWER cannot delete a region", async () => {
    getCurrentUser.mockResolvedValue({ id: "viewer-1", role: "VIEWER" });
    prismaMock.region.findUnique.mockResolvedValue(region());

    await expect(deleteRegionAction("region-1")).rejects.toBeInstanceOf(RedirectSignal);

    expect(prismaMock.region.delete).not.toHaveBeenCalled();
  });

  it("ADMIN can delete a region when safety guards allow (no pharmacies attached)", async () => {
    getCurrentUser.mockResolvedValue({ id: "admin-1", role: "ADMIN" });
    prismaMock.region.findUnique.mockResolvedValue(region());
    prismaMock.region.delete.mockResolvedValue(region());

    await expect(deleteRegionAction("region-1")).rejects.toBeInstanceOf(RedirectSignal);

    expect(prismaMock.region.delete).toHaveBeenCalledExactlyOnceWith({
      where: { id: "region-1" },
    });
  });

  it("ADMIN is still blocked by the safety guard when pharmacies are attached", async () => {
    getCurrentUser.mockResolvedValue({ id: "admin-1", role: "ADMIN" });
    prismaMock.pharmacy.count.mockResolvedValue(3);

    let caught: unknown;
    try {
      await deleteRegionAction("region-1");
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(RedirectSignal);
    expect((caught as RedirectSignal).redirectMessage).toBe(
      "Bu bölgeye kayıtlı eczaneler olduğu için silinemez."
    );
    expect(prismaMock.region.delete).not.toHaveBeenCalled();
  });
});
