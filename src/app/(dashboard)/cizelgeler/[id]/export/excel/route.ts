import { NextResponse } from "next/server";

import { buildDutyScheduleExcel } from "@/lib/scheduling/build-schedule-excel";
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

  const buffer = buildDutyScheduleExcel(schedule);
  const filename = buildDutyScheduleExportFilename(schedule, "xlsx");

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
