import ExcelJS from "exceljs";
import { afterEach, describe, expect, it } from "vitest";

import { historicalImportAction } from "@/app/(dashboard)/gecmis-nobetler/actions";

import { HEADER_ROW } from "../../../scripts/file-security/fixtures";
import { createFileTestAdmin, createFileTestPharmacy, createFileTestRegion, createFileTestSession } from "../helpers/fixtures";
import { fileTestPrisma } from "../helpers/db";
import { FileTestRedirectSignal, setFileTestSessionToken } from "../helpers/setup";

function fileFrom(buffer: Buffer, name = "test.xlsx"): File {
  return new File([new Uint8Array(buffer)], name, {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

// analyzeImportRows marks a row ERROR (blocking import) when its eczane
// adı doesn't match a real Pharmacy row — the fixture generator's
// synthetic names never match anything in a fresh test database, so
// transaction/rollback tests need rows that resolve against real,
// freshly-created Pharmacy rows instead.
async function buildWorkbookForRealPharmacies(
  pharmacies: { name: string; regionName: string }[]
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Sheet1");
  sheet.addRow(HEADER_ROW);
  pharmacies.forEach((pharmacy, i) => {
    sheet.addRow([`0${(i % 9) + 1}.01.2026`, pharmacy.regionName, pharmacy.name, "Normal", "", "", ""]);
  });
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

type ImportOutcome = { redirected: true } | { redirected: false; state: Awaited<ReturnType<typeof historicalImportAction>> };

async function runPreviewThenImport(buffer: Buffer): Promise<ImportOutcome> {
  const previewForm = new FormData();
  previewForm.set("file", fileFrom(buffer));
  const previewState = await historicalImportAction(
    { success: false, message: "" },
    previewForm
  );
  expect(previewState.preview).toBeDefined();
  expect(previewState.preview!.canImport).toBe(true);

  const importForm = new FormData();
  importForm.set("mode", "import");
  importForm.set("rawRows", previewState.rawRowsJson!);
  importForm.set("fileName", previewState.fileName ?? "test.xlsx");
  try {
    const state = await historicalImportAction({ success: false, message: "" }, importForm);
    return { redirected: false, state };
  } catch (error) {
    if (error instanceof FileTestRedirectSignal) return { redirected: true };
    throw error;
  }
}

// Item 7 — transactional consistency, proven against REAL PostgreSQL
// (never a mocked Prisma client). Forces a real exception to fire
// *after* HistoricalDutyRecord rows have already been written inside
// the open transaction, then asserts the real PostgreSQL rollback left
// no trace — the app-level equivalent of scenario B's mid-transaction
// disconnect test (Step 6), using a thrown application error instead of
// a killed connection to reach the exact same rollback boundary.
describe("historical import transaction consistency (real PostgreSQL)", () => {
  afterEach(() => {
    setFileTestSessionToken(undefined);
  });

  it("commits all rows and one AuditLog entry when the import succeeds normally", async () => {
    const admin = await createFileTestAdmin();
    const token = await createFileTestSession(admin.id);
    setFileTestSessionToken(token);

    const region = await createFileTestRegion();
    const pharmacies = await Promise.all(
      Array.from({ length: 5 }, () => createFileTestPharmacy(region.id))
    );
    const buffer = await buildWorkbookForRealPharmacies(
      pharmacies.map((p) => ({ name: p.name, regionName: region.name }))
    );
    const result = await runPreviewThenImport(buffer);

    // A successful import redirects (redirectWithMessage) — it never
    // resolves with a plain success:true state.
    expect(result.redirected).toBe(true);
    const batches = await fileTestPrisma.historicalDutyImportBatch.findMany({ where: { importedById: admin.id } });
    expect(batches).toHaveLength(1);
    const records = await fileTestPrisma.historicalDutyRecord.findMany({ where: { batchId: batches[0].id } });
    expect(records).toHaveLength(5);
    const auditLogs = await fileTestPrisma.auditLog.findMany({
      where: { entity: "HistoricalDutyImportBatch", entityId: batches[0].id },
    });
    expect(auditLogs).toHaveLength(1);
  });

  it("real PostgreSQL rolls back every row when an exception fires after rows have been written but before commit", async () => {
    const admin = await createFileTestAdmin();
    const token = await createFileTestSession(admin.id);
    setFileTestSessionToken(token);

    // Prisma's interactive `$transaction(async (tx) => ...)` gives the
    // callback's `tx` object entirely fresh, independently-constructed
    // delegate instances for every call — verified directly that
    // `createMany` (and every other CRUD method) is an *own property* of
    // each delegate, not shared via any common prototype, so there is no
    // monkey-patchable seam from outside historicalImportAction's own
    // transaction. Instead, force a genuine PostgreSQL-level failure with
    // a BEFORE INSERT trigger on "AuditLog", scoped to this test's own
    // admin id — writeAuditLog(tx, ...) is the LAST statement
    // historicalImportAction runs inside the transaction, strictly after
    // historicalDutyRecord.createMany has already executed earlier in the
    // same still-open transaction, so the trigger fires exactly at the
    // "some rows have been processed, but not yet committed" moment the
    // task requires — and the resulting ROLLBACK is real Postgres
    // behavior, not a mocked one.
    const triggerFnName = `filetest_fail_audit_${admin.id.replace(/-/g, "")}`;
    await fileTestPrisma.$executeRawUnsafe(`
      CREATE OR REPLACE FUNCTION "${triggerFnName}"() RETURNS trigger AS $$
      BEGIN
        IF NEW."userId" = '${admin.id}' THEN
          RAISE EXCEPTION '[test] simulated failure after rows were written, before commit';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
    `);
    await fileTestPrisma.$executeRawUnsafe(`
      CREATE TRIGGER "${triggerFnName}_trigger"
      BEFORE INSERT ON "AuditLog"
      FOR EACH ROW EXECUTE FUNCTION "${triggerFnName}"();
    `);

    const region = await createFileTestRegion();
    const pharmacies = await Promise.all(
      Array.from({ length: 5 }, () => createFileTestPharmacy(region.id))
    );
    const buffer = await buildWorkbookForRealPharmacies(
      pharmacies.map((p) => ({ name: p.name, regionName: region.name }))
    );
    let thrown: unknown;
    try {
      await runPreviewThenImport(buffer);
    } catch (error) {
      thrown = error;
    } finally {
      await fileTestPrisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS "${triggerFnName}_trigger" ON "AuditLog";`);
      await fileTestPrisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS "${triggerFnName}"();`);
    }

    // The caller must see a failure, never a success — either a thrown
    // exception (this app's actual behavior: the transaction catch block
    // re-throws unexpected errors) or, if that policy ever changes, an
    // explicit success:false — never success:true.
    if (thrown === undefined) {
      throw new Error("Expected historicalImportAction to fail, but it resolved without throwing.");
    }

    // Real PostgreSQL rollback evidence: zero orphan batches, zero
    // partial records, zero misleading success AuditLog entries.
    const batches = await fileTestPrisma.historicalDutyImportBatch.findMany({ where: { importedById: admin.id } });
    expect(batches).toHaveLength(0);
    const pharmacyIds = pharmacies.map((p) => p.id);
    const ourRecords = await fileTestPrisma.historicalDutyRecord.findMany({
      where: { pharmacyId: { in: pharmacyIds } },
    });
    expect(ourRecords).toHaveLength(0);
    const auditLogs = await fileTestPrisma.auditLog.findMany({ where: { userId: admin.id, entity: "HistoricalDutyImportBatch" } });
    expect(auditLogs).toHaveLength(0);
  });

  it("retrying the exact same content after a failed import does not create duplicate records (fingerprint-based dedup, real DB unique constraint)", async () => {
    const admin = await createFileTestAdmin();
    const token = await createFileTestSession(admin.id);
    setFileTestSessionToken(token);

    const region = await createFileTestRegion();
    const pharmacies = await Promise.all(
      Array.from({ length: 3 }, () => createFileTestPharmacy(region.id))
    );
    const buffer = await buildWorkbookForRealPharmacies(
      pharmacies.map((p) => ({ name: p.name, regionName: region.name }))
    );
    const first = await runPreviewThenImport(buffer);
    expect(first.redirected).toBe(true);

    // Retry with the identical content — the real DB-level unique
    // fingerprint constraint (not just an app-level pre-check) must
    // reject the second attempt without creating a second batch/record set.
    const second = await runPreviewThenImport(buffer);
    expect(second.redirected).toBe(false);
    if (!second.redirected) expect(second.state.success).toBe(false);

    const batches = await fileTestPrisma.historicalDutyImportBatch.findMany({ where: { importedById: admin.id } });
    expect(batches).toHaveLength(1); // only the first import's batch exists
  });
});
