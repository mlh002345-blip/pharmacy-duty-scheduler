import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

function p2002(target: string[]) {
  return new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
    code: "P2002",
    clientVersion: "test",
    meta: { target },
  });
}

const prismaMock = {
  pharmacy: { findUnique: vi.fn(), findMany: vi.fn() },
  region: { findMany: vi.fn() },
  holiday: { findMany: vi.fn() },
  historicalDutyImportBatch: { create: vi.fn() },
  historicalDutyRecord: { createMany: vi.fn() },
  dutyBalanceAdjustment: { findFirst: vi.fn(), create: vi.fn(), delete: vi.fn() },
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

const { createBalanceAdjustmentAction, historicalImportAction } = await import("./actions");

beforeEach(() => {
  vi.clearAllMocks();
  requirePermissionOrState.mockResolvedValue({ user: { id: "admin-1" } });
  prismaMock.region.findMany.mockResolvedValue([{ id: "region-1", name: "Kadıköy" }]);
  prismaMock.holiday.findMany.mockResolvedValue([]);
  prismaMock.pharmacy.findMany.mockResolvedValue([
    { id: "pharmacy-1", name: "Deva Eczanesi", regionId: "region-1" },
  ]);
});

function adjustmentFormData(overrides: Record<string, string> = {}) {
  const fd = new FormData();
  fd.set("pharmacyId", "pharmacy-1");
  fd.set("points", "10");
  fd.set("reason", "Geçmiş dönem telafi puanı");
  for (const [key, value] of Object.entries(overrides)) fd.set(key, value);
  return fd;
}

describe("createBalanceAdjustmentAction — duplicate submit protection", () => {
  beforeEach(() => {
    prismaMock.pharmacy.findUnique.mockResolvedValue({ id: "pharmacy-1", name: "Deva Eczanesi" });
    prismaMock.dutyBalanceAdjustment.create.mockResolvedValue({ id: "adj-1" });
  });

  it("double-submitting an identical adjustment creates only one row", async () => {
    prismaMock.dutyBalanceAdjustment.findFirst.mockResolvedValueOnce(null);
    await expect(
      createBalanceAdjustmentAction({ success: false, message: "" }, adjustmentFormData())
    ).rejects.toBeInstanceOf(RedirectSignal);
    expect(prismaMock.dutyBalanceAdjustment.create).toHaveBeenCalledOnce();

    // Retried submission: the dedup check now finds the just-created row.
    prismaMock.dutyBalanceAdjustment.findFirst.mockResolvedValueOnce({ id: "adj-1" });
    const second = await createBalanceAdjustmentAction(
      { success: false, message: "" },
      adjustmentFormData()
    );

    expect(second).toEqual({
      success: false,
      message: "Bu denge düzeltmesi daha önce kaydedilmiş.",
    });
    expect(prismaMock.dutyBalanceAdjustment.create).toHaveBeenCalledOnce(); // still only once
  });

  it("a different reason still creates a new row", async () => {
    prismaMock.dutyBalanceAdjustment.findFirst.mockResolvedValue(null);

    await expect(
      createBalanceAdjustmentAction(
        { success: false, message: "" },
        adjustmentFormData({ reason: "Farklı bir gerekçe metni" })
      )
    ).rejects.toBeInstanceOf(RedirectSignal);

    expect(prismaMock.dutyBalanceAdjustment.create).toHaveBeenCalledOnce();
  });

  it("a different scoreDelta (points) still creates a new row", async () => {
    prismaMock.dutyBalanceAdjustment.findFirst.mockResolvedValue(null);

    await expect(
      createBalanceAdjustmentAction(
        { success: false, message: "" },
        adjustmentFormData({ points: "25" })
      )
    ).rejects.toBeInstanceOf(RedirectSignal);

    expect(prismaMock.dutyBalanceAdjustment.create).toHaveBeenCalledOnce();
  });
});

function importFormData(mode: string, rows: unknown[], fileName = "gecmis.xlsx") {
  const fd = new FormData();
  fd.set("mode", mode);
  fd.set("rawRows", JSON.stringify(rows));
  fd.set("fileName", fileName);
  return fd;
}

function importRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    rowNumber: 1,
    tarih: "10.07.2026",
    bolge: "Kadıköy",
    eczaneAdi: "Deva Eczanesi",
    nobetTuru: "Normal",
    telefon: "",
    adres: "",
    not: "",
    ...overrides,
  };
}

describe("historicalImportAction — duplicate confirm protection (DB-backed fingerprint)", () => {
  beforeEach(() => {
    prismaMock.historicalDutyImportBatch.create.mockResolvedValue({ id: "batch-1" });
    prismaMock.historicalDutyRecord.createMany.mockResolvedValue({ count: 1 });
  });

  it("first import still creates batch + records, with the fingerprint stored on the fingerprint field (not note)", async () => {
    await expect(
      historicalImportAction(
        { success: false, message: "" },
        importFormData("import", [importRow()])
      )
    ).rejects.toBeInstanceOf(RedirectSignal);

    expect(prismaMock.historicalDutyImportBatch.create).toHaveBeenCalledExactlyOnceWith({
      data: expect.objectContaining({
        fingerprint: expect.any(String),
      }),
    });
    const createCall = prismaMock.historicalDutyImportBatch.create.mock.calls[0][0];
    expect(createCall.data.note).toBeUndefined();
    expect(prismaMock.historicalDutyRecord.createMany).toHaveBeenCalledOnce();
  });

  it("a duplicate fingerprint (P2002) returns the friendly Turkish message and does not create records", async () => {
    prismaMock.historicalDutyImportBatch.create.mockRejectedValueOnce(p2002(["fingerprint"]));

    const result = await historicalImportAction(
      { success: false, message: "" },
      importFormData("import", [importRow()])
    );

    expect(result).toEqual({
      success: false,
      message: "Bu geçmiş nöbet aktarımı daha önce içeri alınmış.",
    });
    // The batch create failed inside the transaction, so createMany for
    // HistoricalDutyRecord must never have been reached.
    expect(prismaMock.historicalDutyRecord.createMany).not.toHaveBeenCalled();
  });

  it("still throws unexpected (non-P2002) errors instead of hiding them", async () => {
    prismaMock.historicalDutyImportBatch.create.mockRejectedValueOnce(
      new Error("db connection dropped")
    );

    await expect(
      historicalImportAction(
        { success: false, message: "" },
        importFormData("import", [importRow()])
      )
    ).rejects.toThrow("db connection dropped");
  });

  it("a different import payload (different pharmacy) can still be imported", async () => {
    prismaMock.pharmacy.findMany.mockResolvedValue([
      { id: "pharmacy-1", name: "Deva Eczanesi", regionId: "region-1" },
      { id: "pharmacy-2", name: "Şifa Eczanesi", regionId: "region-1" },
    ]);

    await expect(
      historicalImportAction(
        { success: false, message: "" },
        importFormData("import", [importRow()])
      )
    ).rejects.toBeInstanceOf(RedirectSignal);

    await expect(
      historicalImportAction(
        { success: false, message: "" },
        importFormData("import", [importRow({ eczaneAdi: "Şifa Eczanesi" })])
      )
    ).rejects.toBeInstanceOf(RedirectSignal);

    expect(prismaMock.historicalDutyImportBatch.create).toHaveBeenCalledTimes(2);
    const [firstCall, secondCall] = prismaMock.historicalDutyImportBatch.create.mock.calls;
    expect(firstCall[0].data.fingerprint).not.toBe(secondCall[0].data.fingerprint);
  });

  it("duplicate confirm does not double-count duty balance (record set is created only once)", async () => {
    await expect(
      historicalImportAction(
        { success: false, message: "" },
        importFormData("import", [importRow()])
      )
    ).rejects.toBeInstanceOf(RedirectSignal);

    prismaMock.historicalDutyImportBatch.create.mockRejectedValueOnce(p2002(["fingerprint"]));
    await historicalImportAction(
      { success: false, message: "" },
      importFormData("import", [importRow()])
    );

    // getDutyBalanceRows/getOpeningBalanceByPharmacy sum HistoricalDutyRecord
    // rows for the pharmacy — createMany having run only once means the
    // duplicate confirm cannot have inflated that sum.
    expect(prismaMock.historicalDutyRecord.createMany).toHaveBeenCalledOnce();
  });
});

describe("historicalImportAction — historical_import_failed logging", () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    prismaMock.historicalDutyImportBatch.create.mockResolvedValue({ id: "batch-1" });
    prismaMock.historicalDutyRecord.createMany.mockResolvedValue({ count: 1 });
  });

  afterEach(() => {
    errorSpy.mockRestore();
    warnSpy.mockRestore();
  });

  it("logs a warn-level event (not a bare unsignalled catch) when rawRows JSON is malformed, without row contents", async () => {
    const fd = new FormData();
    fd.set("mode", "import");
    fd.set("rawRows", "{not valid json");
    fd.set("fileName", "gecmis.xlsx");

    const result = await historicalImportAction({ success: false, message: "" }, fd);

    expect(result).toEqual({
      success: false,
      message: "Önizleme verisi okunamadı. Lütfen dosyayı yeniden yükleyin.",
    });
    expect(warnSpy).toHaveBeenCalledOnce();
    const record = JSON.parse(warnSpy.mock.calls[0][0] as string);
    expect(record.event).toBe("historical_import_failed");
    expect(record.reason).toBe("raw_rows_json_parse_failed");
    expect(record.userId).toBe("admin-1");
  });

  it("logs the expected duplicate fingerprint rejection at warn, not error, with only a row count (no filename)", async () => {
    prismaMock.historicalDutyImportBatch.create.mockRejectedValueOnce(p2002(["fingerprint"]));

    await historicalImportAction(
      { success: false, message: "" },
      importFormData("import", [importRow()], "hassas-dosya-adi.xlsx")
    );

    expect(errorSpy).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledOnce();
    const record = JSON.parse(warnSpy.mock.calls[0][0] as string);
    expect(record.event).toBe("historical_import_failed");
    expect(record.reason).toBe("duplicate_fingerprint");
    expect(record.acceptedRowCount).toBe(1);
    expect(warnSpy.mock.calls[0][0]).not.toContain("hassas-dosya-adi.xlsx");
  });

  it("logs an unexpected transaction failure at error level, without leaking it as an uninstrumented throw", async () => {
    prismaMock.historicalDutyImportBatch.create.mockRejectedValueOnce(
      new Error("db connection dropped")
    );

    await expect(
      historicalImportAction(
        { success: false, message: "" },
        importFormData("import", [importRow()])
      )
    ).rejects.toThrow("db connection dropped");

    expect(errorSpy).toHaveBeenCalledOnce();
    const record = JSON.parse(errorSpy.mock.calls[0][0] as string);
    expect(record.event).toBe("historical_import_failed");
    expect(record.reason).toBe("unexpected_transaction_error");
    expect(record.error.message).toContain("db connection dropped");
  });
});
