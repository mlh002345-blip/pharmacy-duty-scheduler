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
  pharmacy: { findUnique: vi.fn(), findMany: vi.fn() },
  region: { findMany: vi.fn() },
  holiday: { findMany: vi.fn() },
  historicalDutyImportBatch: { findFirst: vi.fn(), create: vi.fn() },
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

describe("historicalImportAction — duplicate confirm protection", () => {
  beforeEach(() => {
    prismaMock.historicalDutyImportBatch.create.mockResolvedValue({ id: "batch-1" });
    prismaMock.historicalDutyRecord.createMany.mockResolvedValue({ count: 1 });
  });

  it("repeated final import of the same accepted rows does not duplicate records", async () => {
    prismaMock.historicalDutyImportBatch.findFirst.mockResolvedValueOnce(null);

    await expect(
      historicalImportAction(
        { success: false, message: "" },
        importFormData("import", [importRow()])
      )
    ).rejects.toBeInstanceOf(RedirectSignal);

    expect(prismaMock.historicalDutyImportBatch.create).toHaveBeenCalledOnce();
    expect(prismaMock.historicalDutyRecord.createMany).toHaveBeenCalledOnce();

    // Retried confirm submission: the fingerprint lookup now finds the
    // batch that was just created (same file, same rows).
    prismaMock.historicalDutyImportBatch.findFirst.mockResolvedValueOnce({ id: "batch-1" });
    const second = await historicalImportAction(
      { success: false, message: "" },
      importFormData("import", [importRow()])
    );

    expect(second).toEqual({
      success: false,
      message: "Bu geçmiş nöbet aktarımı daha önce içeri alınmış.",
    });
    expect(prismaMock.historicalDutyImportBatch.create).toHaveBeenCalledOnce(); // still once
    expect(prismaMock.historicalDutyRecord.createMany).toHaveBeenCalledOnce(); // still once
  });

  it("a different import payload (different pharmacy) can still be imported", async () => {
    prismaMock.historicalDutyImportBatch.findFirst.mockResolvedValue(null);
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
  });

  it("duplicate confirm does not double-count duty balance (record set is created only once)", async () => {
    prismaMock.historicalDutyImportBatch.findFirst.mockResolvedValueOnce(null);
    await expect(
      historicalImportAction(
        { success: false, message: "" },
        importFormData("import", [importRow()])
      )
    ).rejects.toBeInstanceOf(RedirectSignal);

    prismaMock.historicalDutyImportBatch.findFirst.mockResolvedValueOnce({ id: "batch-1" });
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
