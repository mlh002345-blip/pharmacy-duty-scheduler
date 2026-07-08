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
  user: {
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    update: vi.fn(),
    count: vi.fn(),
  },
  $transaction: vi.fn((fn: (tx: typeof prismaMock) => unknown) => fn(prismaMock)),
};

const invalidateUserSessions = vi.fn();
const clearSessionCookie = vi.fn();
const writeAuditLog = vi.fn();
const revalidatePath = vi.fn();
const requirePermissionOrState = vi.fn();

vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));
vi.mock("@/lib/auth/guard", () => ({
  requirePermissionOrState: (...args: unknown[]) => requirePermissionOrState(...args),
  requirePermissionOrRedirect: vi.fn(),
}));
vi.mock("@/lib/auth/password", () => ({
  hashPassword: vi.fn(async (password: string) => `hashed:${password}`),
}));
vi.mock("@/lib/auth/session", () => ({
  invalidateUserSessions: (...args: unknown[]) => invalidateUserSessions(...args),
  clearSessionCookie: (...args: unknown[]) => clearSessionCookie(...args),
}));
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

const { updateUserAction } = await import("./actions");

const ADMIN = { id: "admin-1", role: "ADMIN" as const };
const OTHER_ADMIN_FOR_QUORUM = { id: "admin-quorum" };

function makeFormData(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [key, value] of Object.entries(fields)) fd.set(key, value);
  return fd;
}

function baseUserRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "target-1",
    name: "Hedef Kullanıcı",
    email: "hedef@example.com",
    role: "STAFF",
    isActive: true,
    passwordHash: "old-hash",
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  requirePermissionOrState.mockResolvedValue({ user: ADMIN });
  prismaMock.user.findFirst.mockResolvedValue(null); // no email duplicate
  prismaMock.user.count.mockResolvedValue(2); // enough active admins for quorum checks
  void OTHER_ADMIN_FOR_QUORUM;
});

describe("updateUserAction — session invalidation on password change", () => {
  it("deletes the target user's sessions when an admin changes another user's password", async () => {
    const before = baseUserRow();
    prismaMock.user.findUnique.mockResolvedValue(before);
    prismaMock.user.update.mockResolvedValue({ ...before, passwordHash: "hashed:NewPass123" });

    const formData = makeFormData({
      name: before.name,
      email: before.email,
      role: before.role,
      isActive: "on",
      password: "NewPass123",
      passwordConfirmation: "NewPass123",
    });

    await expect(
      updateUserAction(before.id, { success: false, message: "" }, formData)
    ).rejects.toBeInstanceOf(RedirectSignal);

    expect(invalidateUserSessions).toHaveBeenCalledExactlyOnceWith(before.id, prismaMock);
    // Admin edited someone else — their own session must not be cleared.
    expect(clearSessionCookie).not.toHaveBeenCalled();
  });

  it("does not delete sessions when updating a user without changing the password", async () => {
    const before = baseUserRow();
    prismaMock.user.findUnique.mockResolvedValue(before);
    prismaMock.user.update.mockResolvedValue(before);

    const formData = makeFormData({
      name: "Güncellenmiş Ad",
      email: before.email,
      role: before.role,
      isActive: "on",
      password: "",
      passwordConfirmation: "",
    });

    await expect(
      updateUserAction(before.id, { success: false, message: "" }, formData)
    ).rejects.toBeInstanceOf(RedirectSignal);

    expect(invalidateUserSessions).not.toHaveBeenCalled();
    expect(clearSessionCookie).not.toHaveBeenCalled();
  });

  it("clears the acting admin's own cookie and redirects to /giris when they change their own password", async () => {
    const before = baseUserRow({ id: ADMIN.id, role: "ADMIN" });
    prismaMock.user.findUnique.mockResolvedValue(before);
    prismaMock.user.update.mockResolvedValue({ ...before, passwordHash: "hashed:NewPass123" });

    const formData = makeFormData({
      name: before.name,
      email: before.email,
      role: before.role,
      isActive: "on",
      password: "NewPass123",
      passwordConfirmation: "NewPass123",
    });

    let caught: unknown;
    try {
      await updateUserAction(before.id, { success: false, message: "" }, formData);
    } catch (error) {
      caught = error;
    }

    expect(invalidateUserSessions).toHaveBeenCalledExactlyOnceWith(before.id, prismaMock);
    expect(clearSessionCookie).toHaveBeenCalledOnce();
    expect(caught).toBeInstanceOf(RedirectSignal);
    expect((caught as RedirectSignal).path).toBe("/giris");
  });

  it("deactivation-related behavior is unaffected by the session-invalidation change (still blocks deactivating the last active admin)", async () => {
    const before = baseUserRow({ id: "sole-admin", role: "ADMIN", isActive: true });
    prismaMock.user.findUnique.mockResolvedValue(before);
    prismaMock.user.count.mockResolvedValue(1); // this is the only active admin

    const formData = makeFormData({
      name: before.name,
      email: before.email,
      role: before.role,
      isActive: "", // attempting to deactivate
      password: "",
      passwordConfirmation: "",
    });

    const result = await updateUserAction(before.id, { success: false, message: "" }, formData);

    expect(result.success).toBe(false);
    expect(result.message).toBe("Sistemde en az bir aktif yönetici bulunmalıdır.");
    expect(prismaMock.user.update).not.toHaveBeenCalled();
    expect(invalidateUserSessions).not.toHaveBeenCalled();
  });

  it("propagates a session-invalidation failure instead of reporting success (password update and session deletion are one transaction)", async () => {
    const before = baseUserRow();
    prismaMock.user.findUnique.mockResolvedValue(before);
    prismaMock.user.update.mockResolvedValue({ ...before, passwordHash: "hashed:NewPass123" });
    invalidateUserSessions.mockRejectedValueOnce(new Error("db connection dropped"));

    const formData = makeFormData({
      name: before.name,
      email: before.email,
      role: before.role,
      isActive: "on",
      password: "NewPass123",
      passwordConfirmation: "NewPass123",
    });

    // Both writes run inside the same prisma.$transaction callback. If
    // session deletion fails, the action must not fall through to a
    // success redirect — that would tell the admin the password was
    // rotated AND old sessions were revoked, when (against a real
    // database) neither actually stuck, since the transaction rolls back.
    await expect(
      updateUserAction(before.id, { success: false, message: "" }, formData)
    ).rejects.toThrow("db connection dropped");
    expect(clearSessionCookie).not.toHaveBeenCalled();
  });
});
