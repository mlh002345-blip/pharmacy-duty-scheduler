import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";

function p2002(target: string[]) {
  return new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
    code: "P2002",
    clientVersion: "test",
    meta: { target },
  });
}

const prismaMock = {
  pharmacy: { findUnique: vi.fn() },
  dutyRequest: { count: vi.fn(), create: vi.fn() },
};

vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));

const { createPublicDutyRequestAction } = await import("./actions");
const { computePublicRequestDedupKey } = await import("@/lib/duty-requests/dedup-key");

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
  prismaMock.dutyRequest.count.mockResolvedValue(0);
  prismaMock.dutyRequest.create.mockResolvedValue({ id: "request-1" });
});

describe("createPublicDutyRequestAction — duplicate submit protection (DB-backed dedupKey)", () => {
  it("a duplicate public request (P2002 on dedupKey) returns the friendly Turkish message", async () => {
    prismaMock.dutyRequest.create.mockRejectedValueOnce(p2002(["dedupKey"]));

    const result = await createPublicDutyRequestAction(
      "token-abc",
      { success: false, message: "" },
      requestFormData()
    );

    expect(result).toEqual({
      success: true,
      message: "Bu talep daha önce alınmış. Lütfen mevcut talebinizin incelenmesini bekleyin.",
    });
  });

  it("the create call is made with a dedupKey so DB-level uniqueness — not an app-level pre-check — is what blocks a truly concurrent duplicate", async () => {
    await createPublicDutyRequestAction(
      "token-abc",
      { success: false, message: "" },
      requestFormData()
    );

    // No pre-create findFirst dedup read exists anymore — the unique
    // index on DutyRequest.dedupKey is the sole protection, so two
    // simultaneous requests race at the DB, not in application code.
    expect(prismaMock.dutyRequest.create).toHaveBeenCalledExactlyOnceWith({
      data: expect.objectContaining({
        pharmacyId: "pharmacy-1",
        source: "PUBLIC_LINK",
        status: "PENDING",
        dedupKey: expect.any(String),
      }),
    });
  });

  it("still throws unexpected (non-P2002) errors instead of hiding them", async () => {
    prismaMock.dutyRequest.create.mockRejectedValueOnce(new Error("db connection dropped"));

    await expect(
      createPublicDutyRequestAction("token-abc", { success: false, message: "" }, requestFormData())
    ).rejects.toThrow("db connection dropped");
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
    expect(prismaMock.dutyRequest.create).not.toHaveBeenCalled();
  });

  it("after the earlier request is reviewed (dedupKey cleared to null), the same request can be submitted again", async () => {
    // reviewDutyRequestAction (nobet-talepleri/actions.ts) sets dedupKey
    // back to null once a request leaves PENDING/LATE. Postgres' unique
    // index then treats that closed row's null as distinct from every
    // other null, so this create no longer collides at the DB and
    // resolves normally instead of throwing P2002.
    prismaMock.dutyRequest.create.mockResolvedValueOnce({ id: "request-2" });

    const result = await createPublicDutyRequestAction(
      "token-abc",
      { success: false, message: "" },
      requestFormData()
    );

    expect(result).toEqual({
      success: true,
      message: "Talebiniz eczacı odası incelemesine gönderildi.",
    });
    expect(prismaMock.dutyRequest.create).toHaveBeenCalledOnce();
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

describe("createPublicDutyRequestAction — public_duty_request_failed logging", () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let infoSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
  });

  afterEach(() => {
    errorSpy.mockRestore();
    infoSpy.mockRestore();
  });

  it("logs the expected duplicate dedupKey rejection at info, not error, without the token or explanation text", async () => {
    prismaMock.dutyRequest.create.mockRejectedValueOnce(p2002(["dedupKey"]));

    await createPublicDutyRequestAction(
      "super-secret-token-value",
      { success: false, message: "" },
      requestFormData({ explanation: "Çok gizli açıklama metni burada." })
    );

    expect(errorSpy).not.toHaveBeenCalled();
    expect(infoSpy).toHaveBeenCalledOnce();
    const record = JSON.parse(infoSpy.mock.calls[0][0] as string);
    expect(record.event).toBe("public_duty_request_failed");
    expect(record.reason).toBe("duplicate_dedup_key");
    expect(record.pharmacyId).toBe("pharmacy-1");
    const line = infoSpy.mock.calls[0][0] as string;
    expect(line).not.toContain("super-secret-token-value");
    expect(line).not.toContain("Çok gizli açıklama metni burada.");
  });

  it("logs an unexpected create failure at error level with only the derived pharmacyId, not the token", async () => {
    prismaMock.dutyRequest.create.mockRejectedValueOnce(new Error("db connection dropped"));

    await expect(
      createPublicDutyRequestAction(
        "another-secret-token",
        { success: false, message: "" },
        requestFormData()
      )
    ).rejects.toThrow("db connection dropped");

    expect(errorSpy).toHaveBeenCalledOnce();
    const record = JSON.parse(errorSpy.mock.calls[0][0] as string);
    expect(record.event).toBe("public_duty_request_failed");
    expect(record.reason).toBe("unexpected_create_error");
    expect(record.pharmacyId).toBe("pharmacy-1");
    expect(errorSpy.mock.calls[0][0]).not.toContain("another-secret-token");
  });
});

describe("computePublicRequestDedupKey", () => {
  const base = {
    pharmacyId: "pharmacy-1",
    requestType: "CANNOT_DUTY",
    startDate: new Date("2026-08-10T00:00:00Z"),
    endDate: new Date("2026-08-12T00:00:00Z"),
    explanation: "Yıllık izinde olacağım için nöbet tutamayacağım.",
  };

  it("is deterministic for identical input", () => {
    expect(computePublicRequestDedupKey(base)).toBe(computePublicRequestDedupKey({ ...base }));
  });

  it("produces a different key for a different explanation", () => {
    expect(computePublicRequestDedupKey(base)).not.toBe(
      computePublicRequestDedupKey({ ...base, explanation: "Farklı bir açıklama metni." })
    );
  });

  it("produces a different key for a different date range", () => {
    expect(computePublicRequestDedupKey(base)).not.toBe(
      computePublicRequestDedupKey({ ...base, startDate: new Date("2026-09-01T00:00:00Z") })
    );
  });

  it("produces a different key for a different request type", () => {
    expect(computePublicRequestDedupKey(base)).not.toBe(
      computePublicRequestDedupKey({ ...base, requestType: "PREFER_DUTY" })
    );
  });
});
