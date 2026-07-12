import ExcelJS from "exceljs";
import { afterEach, describe, expect, it } from "vitest";

import { historicalImportAction } from "@/app/(dashboard)/gecmis-nobetler/actions";
import { prisma as appPrisma } from "@/lib/prisma";
import { buildDutyScheduleExcel } from "@/lib/scheduling/build-schedule-excel";
import { loadDutyScheduleForExport } from "@/lib/scheduling/export-duty-schedule";
import { HistoricalExcelParseError, parseHistoricalExcel } from "@/lib/historical/parse-excel";

import { HEADER_ROW } from "../../../scripts/file-security/fixtures";
import * as F from "../../../scripts/file-security/fixtures";
import { createFileTestAdmin, createFileTestPharmacy, createFileTestRegion, createFileTestSession } from "../helpers/fixtures";
import { fileTestPrisma } from "../helpers/db";
import { FileTestRedirectSignal, setFileTestSessionToken } from "../helpers/setup";

function fileFrom(buffer: Buffer, name = "test.xlsx"): File {
  return new File([new Uint8Array(buffer)], name, {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

async function buildWorkbookForRealPharmacies(pharmacies: { name: string; regionName: string }[]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Sheet1");
  sheet.addRow(HEADER_ROW);
  pharmacies.forEach((pharmacy, i) => {
    sheet.addRow([`0${(i % 9) + 1}.01.2026`, pharmacy.regionName, pharmacy.name, "Normal", "", "", ""]);
  });
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

async function runPreviewThenImport(buffer: Buffer): Promise<{ redirected: boolean }> {
  const previewForm = new FormData();
  previewForm.set("file", fileFrom(buffer));
  const previewState = await historicalImportAction({ success: false, message: "" }, previewForm);
  if (!previewState.preview?.canImport) return { redirected: false };

  const importForm = new FormData();
  importForm.set("mode", "import");
  importForm.set("rawRows", previewState.rawRowsJson!);
  importForm.set("fileName", previewState.fileName ?? "test.xlsx");
  try {
    await historicalImportAction({ success: false, message: "" }, importForm);
    return { redirected: false };
  } catch (error) {
    if (error instanceof FileTestRedirectSignal) return { redirected: true };
    throw error;
  }
}

// Item 10 — interrupted processing. JS has no true mid-function
// preemption, so each phase's interruption is simulated by forcing a
// real exception to fire at that exact phase boundary — the same
// technique task item 7 explicitly sanctions for transaction rollback
// (see 03-transaction-rollback.filesec.test.ts) — and then asserting the
// four required properties: no partial success is reported, no stale DB
// state remains, and the very next request succeeds normally (proving no
// leaked lock, temp file, or corrupted shared state).
describe("interrupted processing releases resources and leaves no partial state", () => {
  afterEach(() => {
    setFileTestSessionToken(undefined);
  });

  it("interruption during workbook parsing (truncated/corrupt archive) leaves nothing to roll back, and the next request succeeds normally", async () => {
    const admin = await createFileTestAdmin();
    setFileTestSessionToken(await createFileTestSession(admin.id));

    const truncated = await F.buildTruncatedZip();
    await expect(parseHistoricalExcel(truncated)).rejects.toThrow(HistoricalExcelParseError);

    const batchesBefore = await fileTestPrisma.historicalDutyImportBatch.count({ where: { importedById: admin.id } });
    expect(batchesBefore).toBe(0);

    const region = await createFileTestRegion();
    const pharmacies = await Promise.all(Array.from({ length: 2 }, () => createFileTestPharmacy(region.id)));
    const validBuffer = await buildWorkbookForRealPharmacies(pharmacies.map((p) => ({ name: p.name, regionName: region.name })));
    const result = await runPreviewThenImport(validBuffer);
    expect(result.redirected).toBe(true);
  });

  it("interruption during row validation/analysis (before any write) leaves no batch, and the next request succeeds normally", async () => {
    const admin = await createFileTestAdmin();
    setFileTestSessionToken(await createFileTestSession(admin.id));
    const region = await createFileTestRegion();
    const pharmacies = await Promise.all(Array.from({ length: 2 }, () => createFileTestPharmacy(region.id)));
    const buffer = await buildWorkbookForRealPharmacies(pharmacies.map((p) => ({ name: p.name, regionName: region.name })));

    // analyzeRows (called from historicalImportAction, both preview and
    // import mode) reads holidays via the top-level `prisma` singleton —
    // never inside a transaction — so it's a genuine, real interception
    // point, unlike the tx-scoped historicalDutyRecord.createMany call
    // (see 03-transaction-rollback.filesec.test.ts for why that one
    // needed a real Postgres trigger instead).
    const original = appPrisma.holiday.findMany.bind(appPrisma.holiday);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (appPrisma.holiday as any).findMany = async () => {
      throw new Error("[test] simulated interruption during row validation");
    };
    let thrown: unknown;
    try {
      await runPreviewThenImport(buffer);
    } catch (error) {
      thrown = error;
    } finally {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (appPrisma.holiday as any).findMany = original;
    }
    expect(thrown).toBeDefined();

    const batches = await fileTestPrisma.historicalDutyImportBatch.count({ where: { importedById: admin.id } });
    expect(batches).toBe(0);

    // Next request, after the interception is restored, must succeed
    // normally — no stale mock, lock, or session left behind.
    const result = await runPreviewThenImport(buffer);
    expect(result.redirected).toBe(true);
  });

  it("interruption during export generation (DB read phase) reports no partial file, and the next export succeeds normally", async () => {
    const region = await createFileTestRegion();
    const pharmacy = await createFileTestPharmacy(region.id);
    const schedule = await fileTestPrisma.dutySchedule.create({
      data: { month: 2, year: 2036, regionId: region.id, status: "PUBLISHED" },
    });
    await fileTestPrisma.dutyAssignment.create({
      data: { dutyScheduleId: schedule.id, pharmacyId: pharmacy.id, date: new Date(Date.UTC(2036, 1, 1)) },
    });

    const original = appPrisma.dutySchedule.findFirst.bind(appPrisma.dutySchedule);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (appPrisma.dutySchedule as any).findFirst = async () => {
      throw new Error("[test] simulated interruption during export generation");
    };
    let thrown: unknown;
    try {
      await loadDutyScheduleForExport(schedule.id, region.organizationId);
    } catch (error) {
      thrown = error;
    } finally {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (appPrisma.dutySchedule as any).findFirst = original;
    }
    expect(thrown).toBeDefined();

    // Next export, after the interception is restored, must succeed
    // normally and produce a complete, correct file.
    const loaded = await loadDutyScheduleForExport(schedule.id, region.organizationId);
    expect(loaded).not.toBeNull();
    const buffer = await buildDutyScheduleExcel(loaded!);
    const readBack = new ExcelJS.Workbook();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await readBack.xlsx.load(buffer as any);
    let found = false;
    readBack.worksheets[0].eachRow((row) => {
      row.eachCell((cell) => {
        if (cell.value === pharmacy.name) found = true;
      });
    });
    expect(found).toBe(true);
  });
});
