import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";

const prismaMock = {
  dutyAssignment: { findUnique: vi.fn(), findMany: vi.fn(), update: vi.fn() },
  pharmacy: { findUnique: vi.fn() },
  unavailability: { findMany: vi.fn() },
  dutyRequest: { findMany: vi.fn() },
  // Test double for an interactive transaction: runs the callback with the
  // same mocked client standing in for `tx`.
  $transaction: vi.fn((fn: (tx: typeof prismaMock) => unknown) => fn(prismaMock)),
};

const requirePermissionOrState = vi.fn();
const writeAuditLog = vi.fn();
const revalidatePath = vi.fn();
const redirect = vi.fn((path: string) => {
  throw new Error(`REDIRECT:${path}`);
});

vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));
vi.mock("@/lib/auth/guard", () => ({
  requirePermissionOrState: (...args: unknown[]) => requirePermissionOrState(...args),
}));
vi.mock("@/lib/audit", () => ({
  writeAuditLog: (...args: unknown[]) => writeAuditLog(...args),
}));
vi.mock("next/cache", () => ({
  revalidatePath: (...args: unknown[]) => revalidatePath(...args),
}));
vi.mock("next/navigation", () => ({
  redirect: (...args: [string]) => redirect(...args),
}));

const { editDutyAssignmentAction } = await import("./assignment-actions");

const ASSIGNMENT_DATE = new Date("2026-07-10T00:00:00.000Z");

function baseAssignment(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "assignment-1",
    pharmacyId: "pharmacy-old",
    dutyScheduleId: "schedule-1",
    date: ASSIGNMENT_DATE,
    note: null,
    isManual: false,
    pharmacy: { id: "pharmacy-old", name: "Eski Eczane" },
    dutySchedule: {
      id: "schedule-1",
      regionId: "region-1",
      region: { id: "region-1", dutyRule: null },
      assignments: [],
    },
    ...overrides,
  };
}

function candidatePharmacy(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "pharmacy-new",
    name: "Yeni Eczane",
    isActive: true,
    regionId: "region-1",
    ...overrides,
  };
}

function makeFormData(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [key, value] of Object.entries(fields)) fd.set(key, value);
  return fd;
}

beforeEach(() => {
  vi.clearAllMocks();
  requirePermissionOrState.mockResolvedValue({ user: { id: "staff-1", role: "STAFF" } });
  prismaMock.dutyAssignment.findUnique.mockResolvedValue(baseAssignment());
  prismaMock.pharmacy.findUnique.mockResolvedValue(candidatePharmacy());
  prismaMock.unavailability.findMany.mockResolvedValue([]);
  prismaMock.dutyRequest.findMany.mockResolvedValue([]);
  prismaMock.dutyAssignment.update.mockResolvedValue({
    pharmacyId: "pharmacy-new",
    note: "Test nedeni",
    isManual: true,
  });
});

function validFormData() {
  return makeFormData({ pharmacyId: "pharmacy-new", reason: "Test nedeni" });
}

describe("editDutyAssignmentAction — mutation and audit log are one transaction", () => {
  it("updates the assignment and writes the audit log, then redirects on success", async () => {
    await expect(
      editDutyAssignmentAction("assignment-1", { success: false, message: "" }, validFormData())
    ).rejects.toThrow("REDIRECT:/cizelgeler/schedule-1");

    expect(prismaMock.dutyAssignment.update).toHaveBeenCalledExactlyOnceWith({
      where: { id: "assignment-1" },
      data: { pharmacyId: "pharmacy-new", isManual: true, note: "Test nedeni" },
    });
    expect(writeAuditLog).toHaveBeenCalledExactlyOnceWith(
      prismaMock,
      expect.objectContaining({
        entity: "DutyAssignment",
        entityId: "assignment-1",
        dutyAssignmentId: "assignment-1",
      })
    );
  });

  it("uses the shared redirectWithMessage contract (path?success=<encoded message>), not a hand-built URL", async () => {
    let thrown: Error | undefined;
    try {
      await editDutyAssignmentAction("assignment-1", { success: false, message: "" }, validFormData());
    } catch (error) {
      thrown = error as Error;
    }

    expect(thrown?.message).toBe(
      `REDIRECT:/cizelgeler/schedule-1?success=${encodeURIComponent("Nöbet ataması güncellendi.")}`
    );
  });

  it("propagates an audit-log failure instead of reporting success (transaction, not a swallowed error)", async () => {
    writeAuditLog.mockRejectedValueOnce(new Error("db connection dropped"));

    // The reassignment and the audit-log write both happen inside the same
    // prisma.$transaction callback. If the audit write throws, the whole
    // transaction rejects — the action must not swallow that and fall
    // through to a success redirect, because against a real database the
    // reassignment itself would have rolled back along with it. A silent
    // failure here would mean a manual duty reassignment happened with no
    // audit trail and no error surfaced to the acting user.
    await expect(
      editDutyAssignmentAction("assignment-1", { success: false, message: "" }, validFormData())
    ).rejects.toThrow("db connection dropped");
    expect(redirect).not.toHaveBeenCalled();
  });

  it("maps a P2002 double-booking violation to a friendly Turkish message", async () => {
    // Simulates two concurrent edits: both pass the in-memory
    // isAlreadyAssignedOnDate check against their own stale snapshot, but
    // the second write hits the DutyAssignment(dutyScheduleId, pharmacyId,
    // date) unique constraint.
    prismaMock.dutyAssignment.update.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
        code: "P2002",
        clientVersion: "test",
        meta: { target: ["dutyScheduleId", "pharmacyId", "date"] },
      })
    );

    const result = await editDutyAssignmentAction(
      "assignment-1",
      { success: false, message: "" },
      validFormData()
    );

    expect(result.success).toBe(false);
    expect(result.errors?.pharmacyId).toEqual([
      "Bu eczane aynı tarihte bu çizelgede zaten nöbetçi olarak atanmış.",
    ]);
    expect(redirect).not.toHaveBeenCalled();
  });

  it("still throws unexpected (non-P2002) errors instead of hiding them", async () => {
    prismaMock.dutyAssignment.update.mockRejectedValueOnce(new Error("some other database error"));

    await expect(
      editDutyAssignmentAction("assignment-1", { success: false, message: "" }, validFormData())
    ).rejects.toThrow("some other database error");
  });

  it("a valid reassignment to a genuinely free pharmacy still works", async () => {
    await expect(
      editDutyAssignmentAction("assignment-1", { success: false, message: "" }, validFormData())
    ).rejects.toThrow("REDIRECT:/cizelgeler/schedule-1");

    expect(prismaMock.dutyAssignment.update).toHaveBeenCalledOnce();
  });
});
