import { NextResponse } from "next/server";
import { redirect } from "next/navigation";

import { getCurrentUser } from "@/lib/auth/session";
import { hasPermission } from "@/lib/auth/permissions";
import { buildDutyScheduleExcel } from "@/lib/scheduling/build-schedule-excel";
import {
  buildDutyScheduleExportFilename,
  loadDutyScheduleForExport,
} from "@/lib/scheduling/export-duty-schedule";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser();
  if (!user) redirect("/giris");
  if (!hasPermission(user.role, "exportSchedule")) {
    return NextResponse.json(
      { message: "Bu işlem için yetkiniz bulunmuyor." },
      { status: 403 }
    );
  }

  const { id } = await params;
  const schedule = await loadDutyScheduleForExport(id);
  if (!schedule) {
    return NextResponse.json({ message: "Nöbet çizelgesi bulunamadı." }, { status: 404 });
  }

  const buffer = await buildDutyScheduleExcel(schedule);
  const filename = buildDutyScheduleExportFilename(schedule, "xlsx");

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
