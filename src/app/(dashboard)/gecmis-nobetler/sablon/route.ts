import { NextResponse } from "next/server";
import { redirect } from "next/navigation";
import ExcelJS from "exceljs";

import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth/session";
import { hasPermission } from "@/lib/auth/permissions";
import { escapeExcelCell } from "@/lib/excel-safety";
import { logger } from "@/lib/observability/logger";
import { getRequestId } from "@/lib/observability/request-id";

// Örnek Geçmiş Nöbet Şablonu: beklenen sütun başlıkları ve sistemdeki gerçek
// eczanelerden 3 örnek satır içeren indirilebilir Excel dosyası.
export async function GET() {
  const user = await getCurrentUser();
  if (!user) redirect("/giris");
  if (!user.organizationId || !hasPermission(user.role, "manageSetupData")) {
    return NextResponse.json(
      { message: "Bu işlem için yetkiniz bulunmuyor." },
      { status: 403 }
    );
  }
  const organizationId = user.organizationId;

  try {
    const samplePharmacies = await prisma.pharmacy.findMany({
      where: { region: { organizationId } },
      take: 3,
      orderBy: { name: "asc" },
      select: {
        name: true,
        phone: true,
        address: true,
        region: { select: { name: true } },
      },
    });

    const headers = ["Tarih", "Bölge", "Eczane Adı", "Nöbet Türü", "Telefon", "Adres", "Not"];
    const sampleTypes = ["Normal", "Hafta Sonu", "Bayram"];
    const sampleDates = ["05.01.2025", "11.01.2025", "30.03.2025"];

    const sampleRows =
      samplePharmacies.length > 0
        ? samplePharmacies.map((pharmacy, index) => [
            sampleDates[index] ?? "05.01.2025",
            pharmacy.region.name,
            pharmacy.name,
            sampleTypes[index] ?? "Normal",
            pharmacy.phone,
            pharmacy.address,
            index === 2 ? "Bayram nöbeti" : "",
          ])
        : [
            [
              "05.01.2025",
              "Merkez",
              "Örnek Eczanesi",
              "Normal",
              "0212 000 00 00",
              "Örnek Mah. No:1",
              "",
            ],
          ];

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet("Gecmis Nobetler");
    worksheet.columns = [
      { width: 12 },
      { width: 14 },
      { width: 24 },
      { width: 12 },
      { width: 16 },
      { width: 40 },
      { width: 20 },
    ];
    worksheet.addRow(headers);
    for (const row of sampleRows) {
      worksheet.addRow(row.map((cell) => escapeExcelCell(cell)));
    }

    const arrayBuffer = await workbook.xlsx.writeBuffer();
    const buffer = Buffer.from(arrayBuffer);

    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": 'attachment; filename="gecmis-nobet-sablonu.xlsx"',
      },
    });
  } catch (error) {
    logger.error(
      "historical_template_export_failed",
      { requestId: await getRequestId(), userId: user.id },
      error
    );
    return NextResponse.json(
      { message: "Excel şablonu oluşturulurken bir hata oluştu." },
      { status: 500 }
    );
  }
}
