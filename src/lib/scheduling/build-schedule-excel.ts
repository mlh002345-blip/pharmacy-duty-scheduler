import ExcelJS from "exceljs";

import { escapeExcelCell } from "@/lib/excel-safety";
import { DUTY_SCHEDULE_STATUS_LABELS } from "./duty-schedule-labels";
import { getTurkishDayName, getTurkishMonthName } from "./date-tr";
import type { DutyScheduleForExport } from "./export-duty-schedule";

export async function buildDutyScheduleExcel(
  schedule: DutyScheduleForExport
): Promise<Buffer> {
  const monthYear = `${getTurkishMonthName(schedule.month)} ${schedule.year}`;
  const statusLabel = DUTY_SCHEDULE_STATUS_LABELS[schedule.status] ?? schedule.status;
  const scheduleName = `${schedule.region.name} ${monthYear} Nöbet Çizelgesi`;

  const infoRows: (string | number)[][] = [
    ["Çizelge Adı", scheduleName],
    ["Bölge", schedule.region.name],
    ["Ay/Yıl", monthYear],
    ["Durum", statusLabel],
    [],
  ];

  const header = [
    "Tarih",
    "Gün",
    "Bölge",
    "Nöbetçi Eczane",
    "Eczacı",
    "Telefon",
    "Adres",
    "Ağırlık",
    "Manuel Değişiklik",
    "Not",
  ];

  const dataRows = schedule.assignments.map((assignment) => [
    assignment.date.toLocaleDateString("tr-TR"),
    getTurkishDayName(assignment.date),
    schedule.region.name,
    assignment.pharmacy.name,
    assignment.pharmacy.pharmacistName,
    assignment.pharmacy.phone,
    assignment.pharmacy.address,
    assignment.weight,
    assignment.isManual ? "Evet" : "Hayır",
    assignment.note ?? "",
  ]);

  const workbook = new ExcelJS.Workbook();
  const sheetName = `${schedule.region.name} ${schedule.month}-${schedule.year}`.slice(0, 31);
  const worksheet = workbook.addWorksheet(sheetName);

  worksheet.columns = [
    { width: 12 },
    { width: 12 },
    { width: 14 },
    { width: 28 },
    { width: 22 },
    { width: 16 },
    { width: 32 },
    { width: 10 },
    { width: 16 },
    { width: 28 },
  ];

  for (const row of [...infoRows, header, ...dataRows]) {
    worksheet.addRow(row.map((cell) => escapeExcelCell(cell)));
  }

  const arrayBuffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(arrayBuffer);
}
