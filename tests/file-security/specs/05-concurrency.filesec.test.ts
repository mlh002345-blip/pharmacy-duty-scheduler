import ExcelJS from "exceljs";
import { afterEach, describe, expect, it } from "vitest";

import { historicalImportAction } from "@/app/(dashboard)/gecmis-nobetler/actions";
import { buildDutyScheduleExcel } from "@/lib/scheduling/build-schedule-excel";
import { loadDutyScheduleForExport } from "@/lib/scheduling/export-duty-schedule";
import { preflightZipArchive, ZipPreflightError } from "@/lib/zip-preflight";

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

// Item 9 — concurrent file operations. The Next.js Server Action session
// mock (tests/file-security/helpers/setup.ts) is a single process-wide
// cookie value, so genuinely distinct concurrent *sessions* can't be
// simulated here — but every import/export below still runs through the
// real parser, real ZIP preflight, and a real, separate PostgreSQL
// transaction per call, which is where cross-request data mixing,
// temp-resource collisions, and connection leaks would actually surface.
describe("concurrent file operations", () => {
  afterEach(() => {
    setFileTestSessionToken(undefined);
  });

  it("runs two simultaneous valid imports without cross-request data mixing", async () => {
    const admin = await createFileTestAdmin();
    setFileTestSessionToken(await createFileTestSession(admin.id));

    const regionA = await createFileTestRegion();
    const regionB = await createFileTestRegion();
    const pharmaciesA = await Promise.all(Array.from({ length: 3 }, () => createFileTestPharmacy(regionA.id)));
    const pharmaciesB = await Promise.all(Array.from({ length: 3 }, () => createFileTestPharmacy(regionB.id)));

    const bufferA = await buildWorkbookForRealPharmacies(pharmaciesA.map((p) => ({ name: p.name, regionName: regionA.name })));
    const bufferB = await buildWorkbookForRealPharmacies(pharmaciesB.map((p) => ({ name: p.name, regionName: regionB.name })));

    const [resultA, resultB] = await Promise.all([runPreviewThenImport(bufferA), runPreviewThenImport(bufferB)]);
    expect(resultA.redirected).toBe(true);
    expect(resultB.redirected).toBe(true);

    const batches = await fileTestPrisma.historicalDutyImportBatch.findMany({ where: { importedById: admin.id } });
    expect(batches).toHaveLength(2);

    const recordsA = await fileTestPrisma.historicalDutyRecord.findMany({
      where: { pharmacyId: { in: pharmaciesA.map((p) => p.id) } },
    });
    const recordsB = await fileTestPrisma.historicalDutyRecord.findMany({
      where: { pharmacyId: { in: pharmaciesB.map((p) => p.id) } },
    });
    expect(recordsA).toHaveLength(3);
    expect(recordsB).toHaveLength(3);
    // No cross-mixing: batch A's records never reference batch B's pharmacies.
    const batchIdsForA = new Set(recordsA.map((r) => r.batchId));
    const batchIdsForB = new Set(recordsB.map((r) => r.batchId));
    expect([...batchIdsForA].some((id) => batchIdsForB.has(id))).toBe(false);
  });

  it("runs five simultaneous valid exports without data mixing between schedules", async () => {
    const schedules = await Promise.all(
      Array.from({ length: 5 }, async (_, i) => {
        const region = await createFileTestRegion();
        const pharmacy = await createFileTestPharmacy(region.id, `${region.name}-Nöbetçi-${i}`);
        const schedule = await fileTestPrisma.dutySchedule.create({
          data: { month: 1, year: 2035, regionId: region.id, status: "PUBLISHED" },
        });
        await fileTestPrisma.dutyAssignment.create({
          data: { dutyScheduleId: schedule.id, pharmacyId: pharmacy.id, date: new Date(Date.UTC(2035, 0, 1 + i)) },
        });
        return { scheduleId: schedule.id, pharmacyName: pharmacy.name };
      })
    );

    const buffers = await Promise.all(
      schedules.map(async ({ scheduleId }) => {
        const loaded = await loadDutyScheduleForExport(scheduleId);
        return buildDutyScheduleExcel(loaded!);
      })
    );

    for (let i = 0; i < schedules.length; i++) {
      const readBack = new ExcelJS.Workbook();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await readBack.xlsx.load(buffers[i] as any);
      const sheet = readBack.worksheets[0];
      let found = false;
      sheet.eachRow((row) => {
        row.eachCell((cell) => {
          if (cell.value === schedules[i].pharmacyName) found = true;
          // No other export's pharmacy name should ever appear in this file.
          for (let j = 0; j < schedules.length; j++) {
            if (j !== i) expect(cell.value).not.toBe(schedules[j].pharmacyName);
          }
        });
      });
      expect(found).toBe(true);
    }
  });

  it("a valid import and a concurrent ZIP-bomb upload don't affect each other", async () => {
    const admin = await createFileTestAdmin();
    setFileTestSessionToken(await createFileTestSession(admin.id));
    const region = await createFileTestRegion();
    const pharmacies = await Promise.all(Array.from({ length: 3 }, () => createFileTestPharmacy(region.id)));
    const validBuffer = await buildWorkbookForRealPharmacies(pharmacies.map((p) => ({ name: p.name, regionName: region.name })));
    const bombBuffer = await F.buildHighCompressionRatioZip(200);

    const memBefore = process.memoryUsage().rss;
    const [validResult, bombResult] = await Promise.allSettled([
      runPreviewThenImport(validBuffer),
      preflightZipArchive(bombBuffer),
    ]);
    const memDeltaMb = (process.memoryUsage().rss - memBefore) / 1024 / 1024;

    expect(validResult.status).toBe("fulfilled");
    if (validResult.status === "fulfilled") expect(validResult.value.redirected).toBe(true);
    expect(bombResult.status).toBe("rejected");
    if (bombResult.status === "rejected") expect(bombResult.reason).toBeInstanceOf(ZipPreflightError);
    // The bomb's 200MB payload must never have been decompressed even
    // while running concurrently with unrelated real work.
    expect(memDeltaMb).toBeLessThan(120);
  });

  it("two imports with overlapping records: the second's exact duplicate content is rejected by the real DB unique fingerprint constraint", async () => {
    const admin = await createFileTestAdmin();
    setFileTestSessionToken(await createFileTestSession(admin.id));
    const region = await createFileTestRegion();
    const pharmacies = await Promise.all(Array.from({ length: 3 }, () => createFileTestPharmacy(region.id)));
    const buffer = await buildWorkbookForRealPharmacies(pharmacies.map((p) => ({ name: p.name, regionName: region.name })));

    const [first, second] = await Promise.allSettled([runPreviewThenImport(buffer), runPreviewThenImport(buffer)]);

    const outcomes = [first, second].map((r) => (r.status === "fulfilled" ? r.value.redirected : false));
    // Exactly one of the two identical concurrent imports may succeed —
    // the DB-level unique fingerprint constraint must prevent both from
    // committing, even when they race.
    expect(outcomes.filter(Boolean)).toHaveLength(1);

    const batches = await fileTestPrisma.historicalDutyImportBatch.findMany({ where: { importedById: admin.id } });
    expect(batches).toHaveLength(1);
  });
});
