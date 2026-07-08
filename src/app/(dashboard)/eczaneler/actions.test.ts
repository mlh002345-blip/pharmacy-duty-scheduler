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
  pharmacy: { findUnique: vi.fn(), delete: vi.fn() },
  dutyAssignment: { count: vi.fn() },
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

const { deletePharmacyAction } = await import("./actions");

function pharmacy(overrides: Partial<Record<string, unknown>> = {}) {
  return { id: "pharmacy-1", name: "Deva Eczanesi", isActive: true, ...overrides };
}

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.dutyAssignment.count.mockResolvedValue(0); // no assignments blocking delete
});

describe("deletePharmacyAction — deleteSetupData is ADMIN-only", () => {
  it("STAFF cannot delete a pharmacy", async () => {
    getCurrentUser.mockResolvedValue({ id: "staff-1", role: "STAFF" });
    prismaMock.pharmacy.findUnique.mockResolvedValue(pharmacy());

    await expect(deletePharmacyAction("pharmacy-1")).rejects.toBeInstanceOf(RedirectSignal);

    expect(prismaMock.pharmacy.delete).not.toHaveBeenCalled();
  });

  it("VIEWER cannot delete a pharmacy", async () => {
    getCurrentUser.mockResolvedValue({ id: "viewer-1", role: "VIEWER" });
    prismaMock.pharmacy.findUnique.mockResolvedValue(pharmacy());

    await expect(deletePharmacyAction("pharmacy-1")).rejects.toBeInstanceOf(RedirectSignal);

    expect(prismaMock.pharmacy.delete).not.toHaveBeenCalled();
  });

  it("ADMIN can delete a pharmacy when safety guards allow (no assignments attached)", async () => {
    getCurrentUser.mockResolvedValue({ id: "admin-1", role: "ADMIN" });
    prismaMock.pharmacy.findUnique.mockResolvedValue(pharmacy());
    prismaMock.pharmacy.delete.mockResolvedValue(pharmacy());

    await expect(deletePharmacyAction("pharmacy-1")).rejects.toBeInstanceOf(RedirectSignal);

    expect(prismaMock.pharmacy.delete).toHaveBeenCalledExactlyOnceWith({
      where: { id: "pharmacy-1" },
    });
  });

  it("ADMIN is still blocked by the safety guard when duty assignments exist", async () => {
    getCurrentUser.mockResolvedValue({ id: "admin-1", role: "ADMIN" });
    prismaMock.dutyAssignment.count.mockResolvedValue(5);

    let caught: unknown;
    try {
      await deletePharmacyAction("pharmacy-1");
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(RedirectSignal);
    expect((caught as RedirectSignal).redirectMessage).toBe(
      "Bu eczaneye ait nöbet ataması olduğu için silinemez."
    );
    expect(prismaMock.pharmacy.delete).not.toHaveBeenCalled();
  });
});
