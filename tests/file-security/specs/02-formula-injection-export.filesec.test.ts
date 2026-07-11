import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";

import { buildDutyScheduleExcel } from "@/lib/scheduling/build-schedule-excel";
import { loadDutyScheduleForExport } from "@/lib/scheduling/export-duty-schedule";

import { createFileTestPharmacy, createFileTestRegion } from "../helpers/fixtures";
import { fileTestPrisma } from "../helpers/db";

// Item 6 — export-side formula-injection neutralization, proven against
// the REAL export pipeline (real DB rows -> real loadDutyScheduleForExport
// -> real buildDutyScheduleExcel -> real ExcelJS round-trip read-back),
// not just the escapeExcelCell() unit (already covered by
// src/lib/excel-safety.test.ts) in isolation.
describe("Excel export neutralizes formula-injection payloads end-to-end", () => {
  const PAYLOADS = [
    '=HYPERLINK("http://evil.example/","click")',
    '=WEBSERVICE("http://evil.example/")',
    "=cmd|' /C calc'!A0",
    "+SUM(1,2)",
    "-1+2",
    "@SUM(1,2)",
  ];

  it.each(PAYLOADS)("neutralizes payload %j written as a pharmacy name in a real schedule export", async (payload) => {
    const region = await createFileTestRegion();
    const pharmacy = await createFileTestPharmacy(region.id, payload);

    const schedule = await fileTestPrisma.dutySchedule.create({
      data: { month: 1, year: 2034, regionId: region.id, status: "PUBLISHED" },
    });
    await fileTestPrisma.dutyAssignment.create({
      data: { dutyScheduleId: schedule.id, pharmacyId: pharmacy.id, date: new Date(Date.UTC(2034, 0, 1)) },
    });

    const loaded = await loadDutyScheduleForExport(schedule.id);
    expect(loaded).not.toBeNull();
    const buffer = await buildDutyScheduleExcel(loaded!);

    // Round-trip: read the generated file back the way a real user's
    // Excel would, and inspect the actual cell value that was written.
    const readBack = new ExcelJS.Workbook();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await readBack.xlsx.load(buffer as any);
    const sheet = readBack.worksheets[0];
    let found = false;
    sheet.eachRow((row) => {
      row.eachCell((cell) => {
        if (typeof cell.value === "string" && cell.value.includes(payload.replace(/^./, ""))) {
          found = true;
          // The written cell must never be a live formula object, and
          // the string value must not start with a formula-trigger
          // character — it must be prefixed (see escapeExcelCell).
          expect(cell.type).not.toBe(ExcelJS.ValueType.Formula);
          expect(["=", "+", "-", "@"]).not.toContain(cell.value.trimStart()[0]);
          expect(cell.value.startsWith("'")).toBe(true);
        }
      });
    });
    expect(found).toBe(true);
  });
});
