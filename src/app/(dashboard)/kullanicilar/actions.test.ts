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
    findFirst: vi.fn(),
    update: vi.fn(),
    count: vi.fn(),
  },
  $transaction: vi.fn((fn: (tx: typeof prismaMock) => unknown) => fn(prismaMock)),
  // assertLastActiveAdminNotRemoved acquires a Postgres advisory lock via a
  // raw query before recounting active admins inside the transaction.
  $executeRaw: vi.fn(async () => 0),
};

const invalidateUserSessions = vi.fn();
const clearSessionCookie = vi.fn();
const writeAuditLog = vi.fn();
const revalidatePath = vi.fn();
const requireOrganizationRole = vi.fn();
const requireOrganizationRoleOrRedirect = vi.fn();

vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));
vi.mock("@/lib/auth/tenant", () => ({
  requireOrganizationRole: (...args: unknown[]) => requireOrganizationRole(...args),
  requireOrganizationRoleOrRedirect: (...args: unknown[]) => requireOrganizationRoleOrRedirect(...args),
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

const { updateUserAction, setUserStatusAction } = await import("./actions");

// Set before calling updateUserAction/setUserStatusAction in each test —
// see the findFirst mockImplementation in beforeEach below.
let currentTargetUser: unknown = null;

const ADMIN = { id: "admin-1", role: "ADMIN" as const, organizationId: "org-1" };
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
  requireOrganizationRole.mockResolvedValue({ user: ADMIN });
  requireOrganizationRoleOrRedirect.mockResolvedValue(ADMIN);
  currentTargetUser = null;
  prismaMock.user.findFirst.mockImplementation(async ({ where }: { where: { id?: string; email?: string } }) => {
    // Real code issues two distinct findFirst calls: one by id
    // (organization-scoped "before" lookup) and one by email (duplicate
    // check). Both share this mock function, so dispatch on the shape
    // of `where` rather than call order.
    if (where.email) return null; // no email duplicate in these tests
    return currentTargetUser;
  });
  prismaMock.user.count.mockResolvedValue(2); // enough active admins for quorum checks
  void OTHER_ADMIN_FOR_QUORUM;
});

describe("updateUserAction — session invalidation on password change", () => {
  it("deletes the target user's sessions when an admin changes another user's password", async () => {
    const before = baseUserRow();
    currentTargetUser = before;
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
    currentTargetUser = before;
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
    currentTargetUser = before;
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
    currentTargetUser = before;
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
    currentTargetUser = before;
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

  it("simulates two concurrent deactivation requests: the second sees the first's committed count and is blocked", async () => {
    // Real concurrency isn't reproducible with a synchronous mock, but this
    // simulates what the advisory lock guarantees: each transaction's count
    // check always reflects the latest committed state, never a stale
    // pre-write snapshot. Two active admins exist; deactivating the first
    // succeeds and the second call's recount reflects that commit.
    const admin1 = baseUserRow({ id: "admin-1-target", role: "ADMIN", isActive: true });
    const admin2 = baseUserRow({ id: "admin-2-target", role: "ADMIN", isActive: true });

    let committedActiveAdmins = 2;
    prismaMock.user.count.mockImplementation(async () => committedActiveAdmins);
    prismaMock.user.update.mockImplementation(async ({ data }: { data: { isActive?: boolean } }) => {
      if (data.isActive === false) committedActiveAdmins -= 1;
      return { ...admin1, ...data };
    });

    currentTargetUser = admin1;
    const formData1 = makeFormData({
      name: admin1.name,
      email: admin1.email,
      role: admin1.role,
      isActive: "",
      password: "",
      passwordConfirmation: "",
    });
    // Success redirects (throws), matching updateUserAction's normal control flow.
    await expect(
      updateUserAction(admin1.id, { success: false, message: "" }, formData1)
    ).rejects.toBeInstanceOf(RedirectSignal);
    expect(committedActiveAdmins).toBe(1);

    currentTargetUser = admin2;
    const formData2 = makeFormData({
      name: admin2.name,
      email: admin2.email,
      role: admin2.role,
      isActive: "",
      password: "",
      passwordConfirmation: "",
    });
    const result2 = await updateUserAction(admin2.id, { success: false, message: "" }, formData2);

    expect(result2.success).toBe(false);
    expect(result2.message).toBe("Sistemde en az bir aktif yönetici bulunmalıdır.");
    expect(committedActiveAdmins).toBe(1);
  });
});

describe("setUserStatusAction — last-active-admin guard runs inside the transaction", () => {
  function activeAdmin(overrides: Partial<Record<string, unknown>> = {}) {
    return baseUserRow({ id: "toggle-admin-1", role: "ADMIN", isActive: true, ...overrides });
  }

  it("cannot deactivate the last active admin", async () => {
    const target = activeAdmin();
    requireOrganizationRoleOrRedirect.mockResolvedValue({ id: "other-admin", role: "ADMIN", organizationId: "org-1" });
    currentTargetUser = target;
    prismaMock.user.count.mockResolvedValue(1);

    await expect(setUserStatusAction(target.id, false)).rejects.toBeInstanceOf(RedirectSignal);
    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });

  it("STAFF/VIEWER toggles still work unaffected (no admin-guard overhead)", async () => {
    const staff = baseUserRow({ id: "staff-1", role: "STAFF", isActive: true });
    requireOrganizationRoleOrRedirect.mockResolvedValue({ id: "admin-1", role: "ADMIN", organizationId: "org-1" });
    currentTargetUser = staff;
    prismaMock.user.update.mockResolvedValue({ ...staff, isActive: false });

    await expect(setUserStatusAction(staff.id, false)).rejects.toBeInstanceOf(RedirectSignal);

    expect(prismaMock.user.update).toHaveBeenCalledExactlyOnceWith({
      where: { id: staff.id },
      data: { isActive: false },
    });
    // Only role === "ADMIN" deactivation needs the guard's count check.
    expect(prismaMock.user.count).not.toHaveBeenCalled();
  });

  it("activating an admin still works (guard only applies to deactivation)", async () => {
    const inactiveAdmin = activeAdmin({ isActive: false });
    requireOrganizationRoleOrRedirect.mockResolvedValue({ id: "other-admin", role: "ADMIN", organizationId: "org-1" });
    currentTargetUser = inactiveAdmin;
    prismaMock.user.update.mockResolvedValue({ ...inactiveAdmin, isActive: true });

    await expect(setUserStatusAction(inactiveAdmin.id, true)).rejects.toBeInstanceOf(RedirectSignal);

    expect(prismaMock.user.update).toHaveBeenCalledExactlyOnceWith({
      where: { id: inactiveAdmin.id },
      data: { isActive: true },
    });
    expect(prismaMock.user.count).not.toHaveBeenCalled();
  });

  it("double-submitting a deactivate call leaves a STAFF user inactive (not flipped back)", async () => {
    const staff = baseUserRow({ id: "staff-2", role: "STAFF", isActive: true });
    requireOrganizationRoleOrRedirect.mockResolvedValue({ id: "admin-1", role: "ADMIN", organizationId: "org-1" });
    currentTargetUser = staff;
    prismaMock.user.update.mockResolvedValue({ ...staff, isActive: false });

    await expect(setUserStatusAction(staff.id, false)).rejects.toBeInstanceOf(RedirectSignal);
    currentTargetUser = { ...staff, isActive: false };
    await expect(setUserStatusAction(staff.id, false)).rejects.toBeInstanceOf(RedirectSignal);

    expect(prismaMock.user.update).toHaveBeenCalledTimes(2);
    for (const call of prismaMock.user.update.mock.calls) {
      expect(call[0]).toEqual({ where: { id: staff.id }, data: { isActive: false } });
    }
  });

  it("last-active-admin protection still applies on every retried deactivate submission", async () => {
    const target = activeAdmin();
    requireOrganizationRoleOrRedirect.mockResolvedValue({ id: "other-admin", role: "ADMIN", organizationId: "org-1" });
    currentTargetUser = target;
    prismaMock.user.count.mockResolvedValue(1);

    await expect(setUserStatusAction(target.id, false)).rejects.toBeInstanceOf(RedirectSignal);
    await expect(setUserStatusAction(target.id, false)).rejects.toBeInstanceOf(RedirectSignal);

    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });
});
