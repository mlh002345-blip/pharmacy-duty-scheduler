import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";

class RedirectSignal extends Error {
  constructor(
    public path: string,
    public kind: "success" | "error",
    public redirectMessage: string
  ) {
    super("REDIRECT");
  }
}

function p2002() {
  return new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
    code: "P2002",
    clientVersion: "test",
    meta: { target: ["name"] },
  });
}

const prismaMock = {
  region: {
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
  pharmacy: { count: vi.fn() },
  // Test double for an interactive transaction: runs the callback with the
  // same mocked client standing in for `tx`, so the mutation + audit-log
  // pair under test still executes as "one transaction" the way production
  // code does, without needing a real database.
  $transaction: vi.fn((fn: (tx: typeof prismaMock) => unknown) => fn(prismaMock)),
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

const { createRegionAction, updateRegionAction, deleteRegionAction, setRegionStatusAction } =
  await import("./actions");

function regionFormData(overrides: Record<string, string> = {}) {
  const fd = new FormData();
  fd.set("name", "Kadıköy");
  fd.set("district", "Kadıköy");
  fd.set("dailyDutyCount", "2");
  fd.set("isActive", "on");
  for (const [key, value] of Object.entries(overrides)) fd.set(key, value);
  return fd;
}

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

  it("propagates an audit-log failure instead of reporting success (transaction, not a swallowed error)", async () => {
    getCurrentUser.mockResolvedValue({ id: "admin-1", role: "ADMIN" });
    prismaMock.region.findUnique.mockResolvedValue(region());
    prismaMock.region.delete.mockResolvedValue(region());
    writeAuditLog.mockRejectedValueOnce(new Error("db connection dropped"));

    // The delete and the audit-log write both happen inside the same
    // prisma.$transaction callback. If the audit write throws, the whole
    // transaction rejects — deleteRegionAction must NOT swallow that and
    // fall through to a success redirect (which would tell the admin the
    // region was deleted-and-audited when only the delete happened, and,
    // against a real database, would also mean the delete itself rolled
    // back rather than silently landing unaudited).
    await expect(deleteRegionAction("region-1")).rejects.toThrow("db connection dropped");
  });
});

describe("createRegionAction / updateRegionAction — concurrent duplicate name", () => {
  beforeEach(() => {
    getCurrentUser.mockResolvedValue({ id: "admin-1", role: "ADMIN" });
  });

  it("maps a P2002 unique-constraint violation on create to the same friendly duplicate message", async () => {
    prismaMock.region.findUnique.mockResolvedValue(null); // pre-check sees no duplicate
    prismaMock.region.create.mockRejectedValueOnce(p2002());

    const result = await createRegionAction({ success: false, message: "" }, regionFormData());

    expect(result.success).toBe(false);
    expect(result.errors?.name).toEqual(["Bu isimde bir bölge zaten mevcut."]);
  });

  it("maps a P2002 unique-constraint violation on update to the same friendly duplicate message", async () => {
    prismaMock.region.findUnique.mockResolvedValue({ id: "region-1", name: "Eski İsim" });
    prismaMock.region.findFirst.mockResolvedValue(null); // pre-check sees no duplicate
    prismaMock.region.update.mockRejectedValueOnce(p2002());

    const result = await updateRegionAction(
      "region-1",
      { success: false, message: "" },
      regionFormData()
    );

    expect(result.success).toBe(false);
    expect(result.errors?.name).toEqual(["Bu isimde bir bölge zaten mevcut."]);
  });

  it("still throws unexpected (non-P2002) errors on create instead of hiding them", async () => {
    prismaMock.region.findUnique.mockResolvedValue(null);
    prismaMock.region.create.mockRejectedValueOnce(new Error("some other database error"));

    await expect(
      createRegionAction({ success: false, message: "" }, regionFormData())
    ).rejects.toThrow("some other database error");
  });

  it("valid region creation still works", async () => {
    prismaMock.region.findUnique.mockResolvedValue(null);
    prismaMock.region.create.mockResolvedValue({ id: "region-new", name: "Kadıköy" });

    await expect(
      createRegionAction({ success: false, message: "" }, regionFormData())
    ).rejects.toBeInstanceOf(RedirectSignal);
    expect(prismaMock.region.create).toHaveBeenCalledOnce();
  });
});

describe("setRegionStatusAction — explicit desired state, retry-safe", () => {
  beforeEach(() => {
    getCurrentUser.mockResolvedValue({ id: "admin-1", role: "ADMIN" });
  });

  it("double-submitting a deactivate call leaves the region inactive", async () => {
    prismaMock.region.findUnique.mockResolvedValue(region({ isActive: true }));
    prismaMock.region.update.mockResolvedValue(region({ isActive: false }));

    await expect(setRegionStatusAction("region-1", false)).rejects.toBeInstanceOf(RedirectSignal);
    prismaMock.region.findUnique.mockResolvedValue(region({ isActive: false }));
    await expect(setRegionStatusAction("region-1", false)).rejects.toBeInstanceOf(RedirectSignal);

    expect(prismaMock.region.update).toHaveBeenCalledTimes(2);
    for (const call of prismaMock.region.update.mock.calls) {
      expect(call[0]).toEqual({ where: { id: "region-1" }, data: { isActive: false } });
    }
  });

  it("double-submitting an activate call leaves the region active", async () => {
    prismaMock.region.findUnique.mockResolvedValue(region({ isActive: false }));
    prismaMock.region.update.mockResolvedValue(region({ isActive: true }));

    await expect(setRegionStatusAction("region-1", true)).rejects.toBeInstanceOf(RedirectSignal);
    await expect(setRegionStatusAction("region-1", true)).rejects.toBeInstanceOf(RedirectSignal);

    expect(prismaMock.region.update).toHaveBeenCalledTimes(2);
    for (const call of prismaMock.region.update.mock.calls) {
      expect(call[0]).toEqual({ where: { id: "region-1" }, data: { isActive: true } });
    }
  });
});
