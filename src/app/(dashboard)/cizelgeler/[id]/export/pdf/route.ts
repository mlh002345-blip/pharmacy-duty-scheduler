import { NextResponse } from "next/server";

import { buildDutySchedulePdf } from "@/lib/pdf/build-schedule-pdf";
import {
  buildDutyScheduleExportFilename,
  loadDutyScheduleForExport,
} from "@/lib/scheduling/export-duty-schedule";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const schedule = await loadDutyScheduleForExport(id);
  if (!schedule) {
    return NextResponse.json({ message: "Nöbet çizelgesi bulunamadı." }, { status: 404 });
  }

  const buffer = await buildDutySchedulePdf(schedule);
  const filename = buildDutyScheduleExportFilename(schedule, "pdf");

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
