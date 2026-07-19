import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";

const prismaMock = {
  dutyAssignment: { findFirst: vi.fn(), findMany: vi.fn(), update: vi.fn() },
  pharmacy: { findFirst: vi.fn() },
  unavailability: { findMany: vi.fn() },
  dutyRequest: { findMany: vi.fn() },
  // Test double for an interactive transaction: runs the callback with the
  // same mocked client standing in for `tx`.
  $transaction: vi.fn((fn: (tx: typeof prismaMock) => unknown) => fn(prismaMock)),
};

const requireOrganizationRole = vi.fn();
const writeAuditLog = vi.fn();
const revalidatePath = vi.fn();
const redirect = vi.fn((path: string) => {
  throw new Error(`REDIRECT:${path}`);
});
const resolveReplacementMembership = vi.fn();
const resolveMinIntervalPolicy = vi.fn();

vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));
vi.mock("@/lib/auth/tenant", () => ({
  requireOrganizationRole: (...args: unknown[]) => requireOrganizationRole(...args),
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
vi.mock("@/lib/duty-rules-v2/persistence-edit/resolve-replacement-membership", () => ({
  resolveReplacementMembership: (...args: unknown[]) => resolveReplacementMembership(...args),
}));
vi.mock("@/lib/duty-rules-v2/persistence-edit/resolve-min-interval-policy", () => ({
  resolveMinIntervalPolicy: (...args: unknown[]) => resolveMinIntervalPolicy(...args),
}));

const { editV2DutyAssignmentAction } = await import("./v2-assignment-actions");

const ASSIGNMENT_DATE = new Date("2026-07-10T00:00:00.000Z");

function baseAssignment(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "assignment-1",
    pharmacyId: "pharmacy-old",
    dutyScheduleId: "schedule-1",
    date: ASSIGNMENT_DATE,
    note: null,
    isManual: false,
    generationRunId: "run-1",
    membershipId: "membership-old",
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
  requireOrganizationRole.mockResolvedValue({
    user: { id: "staff-1", role: "STAFF", organizationId: "org-1" },
  });
  prismaMock.dutyAssignment.findFirst.mockResolvedValue(baseAssignment());
  prismaMock.pharmacy.findFirst.mockResolvedValue(candidatePharmacy());
  prismaMock.unavailability.findMany.mockResolvedValue([]);
  prismaMock.dutyRequest.findMany.mockResolvedValue([]);
  prismaMock.dutyAssignment.update.mockResolvedValue({
    pharmacyId: "pharmacy-new",
    membershipId: "membership-new",
    note: "Test nedeni",
    isManual: true,
  });
  resolveReplacementMembership.mockResolvedValue({ ok: true, membershipId: "membership-new" });
  resolveMinIntervalPolicy.mockResolvedValue(null);
});

function validFormData() {
  return makeFormData({ pharmacyId: "pharmacy-new", reason: "Test nedeni" });
}

describe("editV2DutyAssignmentAction — mutation and audit log are one transaction", () => {
  it("updates pharmacyId + membershipId + isManual + note, and leaves slotKey/origin/etc untouched", async () => {
    await expect(
      editV2DutyAssignmentAction("assignment-1", { success: false, message: "" }, validFormData())
    ).rejects.toThrow("REDIRECT:/cizelgeler/schedule-1");

    expect(prismaMock.dutyAssignment.update).toHaveBeenCalledExactlyOnceWith({
      where: { id: "assignment-1" },
      data: {
        pharmacyId: "pharmacy-new",
        membershipId: "membership-new",
        isManual: true,
        note: "Test nedeni",
      },
    });
    expect(resolveReplacementMembership).toHaveBeenCalledExactlyOnceWith({
      organizationId: "org-1",
      originalMembershipId: "membership-old",
      candidatePharmacyId: "pharmacy-new",
      asOfDate: ASSIGNMENT_DATE,
    });
    expect(writeAuditLog).toHaveBeenCalledExactlyOnceWith(
      prismaMock,
      expect.objectContaining({
        entity: "DutyAssignment",
        entityId: "assignment-1",
        before: expect.objectContaining({ membershipId: "membership-old" }),
        after: expect.objectContaining({ membershipId: "membership-new" }),
      })
    );
  });

  it("rejects a non-V2 assignment (generationRunId null)", async () => {
    prismaMock.dutyAssignment.findFirst.mockResolvedValue(
      baseAssignment({ generationRunId: null })
    );

    const result = await editV2DutyAssignmentAction(
      "assignment-1",
      { success: false, message: "" },
      validFormData()
    );

    expect(result.success).toBe(false);
    expect(result.message).toMatch(/V2 ile oluşturulmadı/);
    expect(prismaMock.dutyAssignment.update).not.toHaveBeenCalled();
  });

  it("rejects when the assignment's own membershipId is null (corrupted generation record)", async () => {
    prismaMock.dutyAssignment.findFirst.mockResolvedValue(
      baseAssignment({ membershipId: null })
    );

    const result = await editV2DutyAssignmentAction(
      "assignment-1",
      { success: false, message: "" },
      validFormData()
    );

    expect(result.success).toBe(false);
    expect(result.message).toMatch(/bozuk/);
    expect(prismaMock.dutyAssignment.update).not.toHaveBeenCalled();
  });

  it("rejects a candidate that is not a member of the assignment's rotation pool", async () => {
    resolveReplacementMembership.mockResolvedValue({
      ok: false,
      code: "CANDIDATE_NOT_POOL_MEMBER",
      message: "Seçilen eczane, bu atamanın ait olduğu rotasyon havuzunun üyesi değil.",
    });

    const result = await editV2DutyAssignmentAction(
      "assignment-1",
      { success: false, message: "" },
      validFormData()
    );

    expect(result.success).toBe(false);
    expect(result.errors?.pharmacyId).toEqual([
      "Seçilen eczane, bu atamanın ait olduğu rotasyon havuzunun üyesi değil.",
    ]);
    expect(prismaMock.dutyAssignment.update).not.toHaveBeenCalled();
  });

  it("still enforces: blocked by an approved CANNOT_DUTY/EMERGENCY_EXCUSE request", async () => {
    prismaMock.dutyRequest.findMany.mockResolvedValue([
      {
        pharmacyId: "pharmacy-new",
        requestType: "CANNOT_DUTY",
        startDate: ASSIGNMENT_DATE,
        endDate: ASSIGNMENT_DATE,
      },
    ]);

    const result = await editV2DutyAssignmentAction(
      "assignment-1",
      { success: false, message: "" },
      validFormData()
    );

    expect(result.success).toBe(false);
    expect(result.errors?.pharmacyId?.[0]).toMatch(/onaylı nöbet tutamama/);
    expect(prismaMock.dutyAssignment.update).not.toHaveBeenCalled();
  });

  it("still enforces: candidate unavailable on that date", async () => {
    prismaMock.unavailability.findMany.mockResolvedValue([
      { pharmacyId: "pharmacy-new", startDate: ASSIGNMENT_DATE, endDate: ASSIGNMENT_DATE },
    ]);

    const result = await editV2DutyAssignmentAction(
      "assignment-1",
      { success: false, message: "" },
      validFormData()
    );

    expect(result.success).toBe(false);
    expect(result.errors?.pharmacyId).toEqual(["Seçilen eczane bu tarihte mazeretli."]);
  });

  it("still enforces: candidate already assigned that date in this schedule", async () => {
    prismaMock.dutyAssignment.findFirst.mockResolvedValue(
      baseAssignment({
        dutySchedule: {
          id: "schedule-1",
          regionId: "region-1",
          region: { id: "region-1", dutyRule: null },
          assignments: [{ id: "other", pharmacyId: "pharmacy-new", date: ASSIGNMENT_DATE }],
        },
      })
    );

    const result = await editV2DutyAssignmentAction(
      "assignment-1",
      { success: false, message: "" },
      validFormData()
    );

    expect(result.success).toBe(false);
    expect(result.errors?.pharmacyId).toEqual(["Seçilen eczane bu tarihte zaten atanmış."]);
  });

  it("min-interval warning fires via resolveMinIntervalPolicy (native V2 policy, no DutyRule) and requires confirmation", async () => {
    resolveMinIntervalPolicy.mockResolvedValue({ minDaysBetweenDuties: 10 });
    prismaMock.dutyAssignment.findMany.mockResolvedValue([
      { id: "other", pharmacyId: "pharmacy-new", date: new Date("2026-07-05T00:00:00.000Z") },
    ]);

    const result = await editV2DutyAssignmentAction(
      "assignment-1",
      { success: false, message: "" },
      validFormData()
    );

    expect(result.requiresConfirmation).toBe(true);
    expect(result.warning).toMatch(/Asgari nöbet aralığı kuralı \(10 gün\)/);
    expect(prismaMock.dutyAssignment.update).not.toHaveBeenCalled();
  });

  it("confirmOverride=true proceeds past the min-interval warning", async () => {
    resolveMinIntervalPolicy.mockResolvedValue({ minDaysBetweenDuties: 10 });
    prismaMock.dutyAssignment.findMany.mockResolvedValue([
      { id: "other", pharmacyId: "pharmacy-new", date: new Date("2026-07-05T00:00:00.000Z") },
    ]);

    await expect(
      editV2DutyAssignmentAction(
        "assignment-1",
        { success: false, message: "" },
        makeFormData({
          pharmacyId: "pharmacy-new",
          reason: "Test nedeni",
          confirmOverride: "true",
        })
      )
    ).rejects.toThrow("REDIRECT:/cizelgeler/schedule-1");

    expect(prismaMock.dutyAssignment.update).toHaveBeenCalledOnce();
  });

  it("rejects a tenant-mismatched assignment (findFirst scoped query returns nothing)", async () => {
    prismaMock.dutyAssignment.findFirst.mockResolvedValue(null);

    const result = await editV2DutyAssignmentAction(
      "assignment-1",
      { success: false, message: "" },
      validFormData()
    );

    expect(result).toEqual({ success: false, message: "Nöbet ataması bulunamadı." });
    expect(prismaMock.dutyAssignment.update).not.toHaveBeenCalled();
  });

  it("maps a P2002 double-booking violation to a friendly Turkish message", async () => {
    prismaMock.dutyAssignment.update.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
        code: "P2002",
        clientVersion: "test",
        meta: { target: ["dutyScheduleId", "pharmacyId", "date"] },
      })
    );

    const result = await editV2DutyAssignmentAction(
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
});
