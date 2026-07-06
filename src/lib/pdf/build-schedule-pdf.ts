import path from "node:path";
import PDFDocument from "pdfkit";

import { DUTY_SCHEDULE_STATUS_LABELS } from "@/lib/scheduling/duty-schedule-labels";
import { getTurkishDayName, getTurkishMonthName } from "@/lib/scheduling/date-tr";
import type { DutyScheduleForExport } from "@/lib/scheduling/export-duty-schedule";

const FONT_REGULAR = path.join(process.cwd(), "src/lib/pdf/fonts/DejaVuSans.ttf");
const FONT_BOLD = path.join(process.cwd(), "src/lib/pdf/fonts/DejaVuSans-Bold.ttf");

const PAGE_MARGIN = 40;

const COLUMNS = [
  { key: "date", label: "Tarih", x: PAGE_MARGIN, width: 60 },
  { key: "day", label: "Gün", x: PAGE_MARGIN + 60, width: 60 },
  { key: "pharmacy", label: "Nöbetçi Eczane", x: PAGE_MARGIN + 120, width: 130 },
  { key: "phone", label: "Telefon", x: PAGE_MARGIN + 250, width: 80 },
  { key: "address", label: "Adres", x: PAGE_MARGIN + 330, width: 130 },
  { key: "note", label: "Not", x: PAGE_MARGIN + 460, width: 65 },
] as const;

function drawTableHeader(doc: PDFKit.PDFDocument) {
  doc.font(FONT_BOLD).fontSize(9);
  const y = doc.y;
  for (const column of COLUMNS) {
    doc.text(column.label, column.x, y, { width: column.width });
  }
  doc.moveDown(0.5);
  doc
    .moveTo(PAGE_MARGIN, doc.y)
    .lineTo(PAGE_MARGIN + 525, doc.y)
    .strokeColor("#cccccc")
    .stroke();
  doc.moveDown(0.3);
  doc.font(FONT_REGULAR);
}

export async function buildDutySchedulePdf(
  schedule: DutyScheduleForExport
): Promise<Buffer> {
  // pdfkit defaults to its bundled Helvetica AFM metrics file, which Next's
  // server bundler doesn't preserve on disk (ENOENT at runtime). Passing our
  // embedded TTF as the constructor's initial font avoids that file read
  // entirely, and doubles as our Turkish-character-safe font.
  const doc = new PDFDocument({
    margin: PAGE_MARGIN,
    size: "A4",
    autoFirstPage: true,
    font: FONT_REGULAR,
  });
  const chunks: Buffer[] = [];
  doc.on("data", (chunk) => chunks.push(chunk));

  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });

  doc.registerFont("DejaVuSans", FONT_REGULAR);
  doc.registerFont("DejaVuSans-Bold", FONT_BOLD);

  const monthYear = `${getTurkishMonthName(schedule.month)} ${schedule.year}`;
  const statusLabel = DUTY_SCHEDULE_STATUS_LABELS[schedule.status] ?? schedule.status;

  doc.font(FONT_BOLD).fontSize(16).text("Eczane Nöbet Çizelgesi", { align: "left" });
  doc.moveDown(0.5);
  doc.font(FONT_REGULAR).fontSize(10);
  doc.text(`Bölge: ${schedule.region.name}`);
  doc.text(`Ay/Yıl: ${monthYear}`);
  doc.text(`Durum: ${statusLabel}`);
  doc.text(`Oluşturulma Tarihi: ${new Date().toLocaleDateString("tr-TR")}`);
  doc.moveDown(1);

  drawTableHeader(doc);

  for (const assignment of schedule.assignments) {
    const cells: Record<(typeof COLUMNS)[number]["key"], string> = {
      date: assignment.date.toLocaleDateString("tr-TR"),
      day: getTurkishDayName(assignment.date),
      pharmacy: assignment.pharmacy.name,
      phone: assignment.pharmacy.phone,
      address: assignment.pharmacy.address,
      note: assignment.note ?? "-",
    };

    doc.fontSize(9);
    const rowHeight = Math.max(
      ...COLUMNS.map((column) =>
        doc.heightOfString(cells[column.key], { width: column.width })
      )
    );

    if (doc.y + rowHeight > doc.page.height - PAGE_MARGIN) {
      doc.addPage();
      drawTableHeader(doc);
    }

    const rowY = doc.y;
    for (const column of COLUMNS) {
      doc.text(cells[column.key], column.x, rowY, { width: column.width });
    }
    doc.y = rowY + rowHeight + 6;
  }

  if (schedule.assignments.length === 0) {
    doc.text("Bu çizelge için atama bulunmuyor.");
  }

  doc.end();
  return done;
}
