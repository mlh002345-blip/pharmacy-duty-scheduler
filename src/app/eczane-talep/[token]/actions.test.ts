import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = {
  pharmacy: { findUnique: vi.fn() },
  dutyRequest: { findFirst: vi.fn(), count: vi.fn(), create: vi.fn() },
};

vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));

const { createPublicDutyRequestAction } = await import("./actions");

function pharmacy(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "pharmacy-1",
    name: "Deva Eczanesi",
    regionId: "region-1",
    isActive: true,
    ...overrides,
  };
}

function requestFormData(overrides: Record<string, string> = {}) {
  const fd = new FormData();
  fd.set("requestType", "CANNOT_DUTY");
  fd.set("startDate", "2026-08-10");
  fd.set("endDate", "2026-08-12");
  fd.set("explanation", "Yıllık izinde olacağım için nöbet tutamayacağım.");
  for (const [key, value] of Object.entries(overrides)) fd.set(key, value);
  return fd;
}

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.pharmacy.findUnique.mockResolvedValue(pharmacy());
  prismaMock.dutyRequest.findFirst.mockResolvedValue(null);
  prismaMock.dutyRequest.count.mockResolvedValue(0);
  prismaMock.dutyRequest.create.mockResolvedValue({ id: "request-1" });
});

describe("createPublicDutyRequestAction — duplicate submit protection", () => {
  it("double-submitting the exact same request creates only one DutyRequest row", async () => {
    const first = await createPublicDutyRequestAction(
      "token-abc",
      { success: false, message: "" },
      requestFormData()
    );
    expect(first.success).toBe(true);
    expect(prismaMock.dutyRequest.create).toHaveBeenCalledOnce();

    // Simulate the retried/double-clicked submission: the first request now
    // exists in the DB and is found by the dedup check.
    prismaMock.dutyRequest.findFirst.mockResolvedValue({ id: "request-1" });
    const second = await createPublicDutyRequestAction(
      "token-abc",
      { success: false, message: "" },
      requestFormData()
    );

    expect(second.success).toBe(true);
    expect(second.message).toBe(
      "Bu talep daha önce alınmış. Lütfen mevcut talebinizin incelenmesini bekleyin."
    );
    expect(prismaMock.dutyRequest.create).toHaveBeenCalledOnce(); // still only once
  });

  it("a genuinely different request (different date range) still creates a new row", async () => {
    prismaMock.dutyRequest.findFirst.mockResolvedValue(null); // no matching open request

    const result = await createPublicDutyRequestAction(
      "token-abc",
      { success: false, message: "" },
      requestFormData({ startDate: "2026-09-01", endDate: "2026-09-02" })
    );

    expect(result.success).toBe(true);
    expect(prismaMock.dutyRequest.create).toHaveBeenCalledOnce();
  });

  it("a different request type for the same dates still creates a new row", async () => {
    prismaMock.dutyRequest.findFirst.mockResolvedValue(null);

    const result = await createPublicDutyRequestAction(
      "token-abc",
      { success: false, message: "" },
      requestFormData({ requestType: "PREFER_DUTY" })
    );

    expect(result.success).toBe(true);
    expect(prismaMock.dutyRequest.create).toHaveBeenCalledOnce();
  });

  it("invalid token behavior is unchanged (no info leak, no DB writes)", async () => {
    prismaMock.pharmacy.findUnique.mockResolvedValue(null);

    const result = await createPublicDutyRequestAction(
      "bad-token",
      { success: false, message: "" },
      requestFormData()
    );

    expect(result).toEqual({
      success: false,
      message: "Bağlantı geçersiz veya artık kullanılamıyor.",
    });
    expect(prismaMock.dutyRequest.findFirst).not.toHaveBeenCalled();
    expect(prismaMock.dutyRequest.create).not.toHaveBeenCalled();
  });

  it("an inactive pharmacy's token behaves like an invalid token", async () => {
    prismaMock.pharmacy.findUnique.mockResolvedValue(pharmacy({ isActive: false }));

    const result = await createPublicDutyRequestAction(
      "token-abc",
      { success: false, message: "" },
      requestFormData()
    );

    expect(result.success).toBe(false);
    expect(prismaMock.dutyRequest.create).not.toHaveBeenCalled();
  });
});
