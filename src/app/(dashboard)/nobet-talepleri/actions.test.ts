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
  dutyRequest: { findUnique: vi.fn(), updateMany: vi.fn() },
  $transaction: vi.fn((fn: (tx: typeof prismaMock) => unknown) => fn(prismaMock)),
};

const requirePermissionOrState = vi.fn();
const writeAuditLog = vi.fn();

vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));
vi.mock("@/lib/auth/guard", () => ({
  requirePermissionOrState: (...args: unknown[]) => requirePermissionOrState(...args),
}));
vi.mock("@/lib/audit", () => ({
  writeAuditLog: (...args: unknown[]) => writeAuditLog(...args),
}));
vi.mock("@/lib/flash-redirect", () => ({
  redirectWithMessage: (path: string, kind: "success" | "error", message: string) => {
    throw new RedirectSignal(path, kind, message);
  },
}));

const { reviewDutyRequestAction } = await import("./actions");

function request(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "request-1",
    status: "PENDING",
    requestType: "CANNOT_DUTY",
    pharmacy: { name: "Deva Eczanesi" },
    ...overrides,
  };
}

function reviewFormData(decision: string, reviewNote = "") {
  const fd = new FormData();
  fd.set("decision", decision);
  if (reviewNote) fd.set("reviewNote", reviewNote);
  return fd;
}

beforeEach(() => {
  vi.clearAllMocks();
  requirePermissionOrState.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } });
});

describe("reviewDutyRequestAction — conditional update prevents double review", () => {
  it("second review attempt does not overwrite the final status and returns a friendly message", async () => {
    // Simulates: reviewer 1's update already flipped status away from
    // PENDING before reviewer 2's updateMany runs (0 rows matched).
    prismaMock.dutyRequest.findUnique.mockResolvedValue(request());
    prismaMock.dutyRequest.updateMany.mockResolvedValue({ count: 0 });

    const result = await reviewDutyRequestAction(
      "request-1",
      { success: false, message: "" },
      reviewFormData("REJECTED", "İkinci inceleme")
    );

    expect(result.success).toBe(false);
    expect(result.message).toBe("Bu talep daha önce incelenmiş. Lütfen sayfayı yenileyin.");
    expect(writeAuditLog).not.toHaveBeenCalled();
  });

  it("successful review updates the status conditionally and writes the audit log in the same transaction", async () => {
    prismaMock.dutyRequest.findUnique.mockResolvedValue(request());
    prismaMock.dutyRequest.updateMany.mockResolvedValue({ count: 1 });

    await expect(
      reviewDutyRequestAction(
        "request-1",
        { success: false, message: "" },
        reviewFormData("APPROVED")
      )
    ).rejects.toBeInstanceOf(RedirectSignal);

    expect(prismaMock.dutyRequest.updateMany).toHaveBeenCalledExactlyOnceWith({
      where: { id: "request-1", status: { in: ["PENDING", "LATE"] } },
      data: expect.objectContaining({ status: "APPROVED" }),
    });
    expect(writeAuditLog).toHaveBeenCalledOnce();
  });

  it("rejects with a review note when the request is still pending", async () => {
    prismaMock.dutyRequest.findUnique.mockResolvedValue(request());
    prismaMock.dutyRequest.updateMany.mockResolvedValue({ count: 1 });

    await expect(
      reviewDutyRequestAction(
        "request-1",
        { success: false, message: "" },
        reviewFormData("REJECTED", "Yeterli gerekçe yok")
      )
    ).rejects.toBeInstanceOf(RedirectSignal);

    expect(writeAuditLog).toHaveBeenCalledOnce();
  });

  it("blocks review of a request that is already APPROVED/REJECTED at the initial read (sequential case)", async () => {
    prismaMock.dutyRequest.findUnique.mockResolvedValue(request({ status: "APPROVED" }));

    const result = await reviewDutyRequestAction(
      "request-1",
      { success: false, message: "" },
      reviewFormData("REJECTED", "Çok geç")
    );

    expect(result.success).toBe(false);
    expect(result.message).toBe("Yalnızca beklemede olan talepler incelenebilir.");
    expect(prismaMock.dutyRequest.updateMany).not.toHaveBeenCalled();
  });

  it("clears dedupKey to null when a request leaves PENDING/LATE, so an identical future public submission is not blocked", async () => {
    prismaMock.dutyRequest.findUnique.mockResolvedValue(request());
    prismaMock.dutyRequest.updateMany.mockResolvedValue({ count: 1 });

    await expect(
      reviewDutyRequestAction(
        "request-1",
        { success: false, message: "" },
        reviewFormData("APPROVED")
      )
    ).rejects.toBeInstanceOf(RedirectSignal);

    expect(prismaMock.dutyRequest.updateMany).toHaveBeenCalledExactlyOnceWith({
      where: { id: "request-1", status: { in: ["PENDING", "LATE"] } },
      data: expect.objectContaining({ dedupKey: null }),
    });
  });
});
