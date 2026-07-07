import { NextResponse } from "next/server";
import { redirect } from "next/navigation";
import * as XLSX from "xlsx";

import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth/session";

// Örnek Geçmiş Nöbet Şablonu: beklenen sütun başlıkları ve sistemdeki gerçek
// eczanelerden 3 örnek satır içeren indirilebilir Excel dosyası.
export async function GET() {
  const user = await getCurrentUser();
  if (!user) redirect("/giris");

  const samplePharmacies = await prisma.pharmacy.findMany({
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
          ["05.01.2025", "Merkez", "Örnek Eczanesi", "Normal", "0212 000 00 00", "Örnek Mah. No:1", ""],
        ];

  const worksheet = XLSX.utils.aoa_to_sheet([headers, ...sampleRows]);
  worksheet["!cols"] = [
    { wch: 12 },
    { wch: 14 },
    { wch: 24 },
    { wch: 12 },
    { wch: 16 },
    { wch: 40 },
    { wch: 20 },
  ];
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Gecmis Nobetler");

  const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": 'attachment; filename="gecmis-nobet-sablonu.xlsx"',
    },
  });
}
