import * as XLSX from "xlsx";

import { DUTY_SCHEDULE_STATUS_LABELS } from "./duty-schedule-labels";
import { getTurkishDayName, getTurkishMonthName } from "./date-tr";
import type { DutyScheduleForExport } from "./export-duty-schedule";

export function buildDutyScheduleExcel(schedule: DutyScheduleForExport): Buffer {
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

  const worksheet = XLSX.utils.aoa_to_sheet([...infoRows, header, ...dataRows]);
  worksheet["!cols"] = [
    { wch: 12 },
    { wch: 12 },
    { wch: 14 },
    { wch: 28 },
    { wch: 22 },
    { wch: 16 },
    { wch: 32 },
    { wch: 10 },
    { wch: 16 },
    { wch: 28 },
  ];

  const workbook = XLSX.utils.book_new();
  const sheetName = `${schedule.region.name} ${schedule.month}-${schedule.year}`.slice(0, 31);
  XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);

  const arrayBuffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
  return arrayBuffer as Buffer;
}
