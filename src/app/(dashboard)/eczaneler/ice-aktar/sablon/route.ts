import { NextResponse } from "next/server";
import { redirect } from "next/navigation";
import ExcelJS from "exceljs";

import { getCurrentUser } from "@/lib/auth/session";
import { hasPermission } from "@/lib/auth/permissions";
import { escapeExcelCell } from "@/lib/excel-safety";
import { logger } from "@/lib/observability/logger";
import { getRequestId } from "@/lib/observability/request-id";

const EXPLANATION_LINES: [string, string][] = [
  ["Zorunlu Sütunlar", "Bölge, Eczane Adı, Eczacı Adı Soyadı, Telefon"],
  [
    "Kabul Edilen Başlık Varyasyonları",
    'Bölge: "Bölge", "Bolge", "İlçe", "Ilce", "İlçe/İl". Eczane Adı: "Eczane", "Eczane Adı", "Eczane Adi". Eczacı Adı Soyadı: "Eczacı", "Eczaci", "Eczacı Adı Soyadı", "Eczaci Adi Soyadi". Telefon: "Telefon", "Telefon No", "Telefon Numarası". Aktif: "Aktif", "Aktiflik", "Durum".',
  ],
  [
    "Kabul Edilen Telefon Biçimleri",
    "7 haneli yerel numara (yalnızca yükleme formunda bir Varsayılan Alan Kodu girilmişse), alan kodu içeren 10 haneli ulusal numara, 0 ile başlayan numara, +90 ile başlayan numara.",
  ],
  [
    "Varsayılan Alan Kodu",
    "Dosyadaki bir telefon numarası yalnızca 7 haneliyse, İçe Aktarma sayfasındaki Varsayılan Alan Kodu alanına 3 haneli bir alan kodu girilmelidir; aksi halde o satır aktarılamaz. Alan kodu asla otomatik tahmin edilmez.",
  ],
  [
    "Yinelenen Kayıt Kuralları",
    "Aynı bölgede aynı ada sahip iki satır (dosya içinde) veya sistemde zaten kayıtlı bir eczane, o satırın aktarılmasını engeller.",
  ],
  [
    "Bölge Önkoşulu",
    "Bölge, içe aktarımdan önce sistemde tanımlı olmalıdır. Bilinmeyen bir bölge adı, o satırın aktarılmasını engeller; bölgeler içe aktarım sırasında otomatik oluşturulmaz.",
  ],
  ["Dosya Boyutu Sınırı", "En fazla 5 MB."],
  ["Satır Sınırı", "Tek dosyada en fazla 5.000 veri satırı."],
  [
    "Tümü ya da Hiçbiri",
    "Dosyadaki tüm satırlar aktarıma hazır olmadıkça hiçbir eczane oluşturulmaz; kısmi içe aktarım yapılmaz.",
  ],
  [
    "Mevcut Kayıtlar",
    "Bu sürümde (V1), sistemde zaten kayıtlı bir eczane içe aktarım ile güncellenmez; yalnızca yeni eczaneler oluşturulur.",
  ],
  [
    "Aktif Sütunu Kabul Edilen Değerler",
    'Evet / Hayır, true / false, 1 / 0, Aktif / Pasif. Boş bırakılırsa varsayılan olarak "Evet" (aktif) kabul edilir.',
  ],
];

export async function GET() {
  const user = await getCurrentUser();
  if (!user) redirect("/giris");
  if (!user.organizationId || !hasPermission(user.role, "importPharmacies")) {
    return NextResponse.json(
      { message: "Bu işlem için yetkiniz bulunmuyor." },
      { status: 403 }
    );
  }

  try {
    const workbook = new ExcelJS.Workbook();

    const eczanelerSheet = workbook.addWorksheet("Eczaneler");
    eczanelerSheet.columns = [
      { width: 22 },
      { width: 28 },
      { width: 26 },
      { width: 18 },
      { width: 10 },
    ];
    eczanelerSheet.addRow(["Bölge", "Eczane Adı", "Eczacı Adı Soyadı", "Telefon", "Aktif"]);
    eczanelerSheet.addRow(
      ["Örnek Bölge", "Örnek Eczanesi", "Örnek Eczacı Adı", "0212 000 00 00", "Evet"].map((cell) =>
        escapeExcelCell(cell)
      )
    );

    const aciklamalarSheet = workbook.addWorksheet("Açıklamalar");
    aciklamalarSheet.columns = [{ width: 28 }, { width: 90 }];
    aciklamalarSheet.addRow(["Konu", "Açıklama"]);
    for (const [topic, explanation] of EXPLANATION_LINES) {
      aciklamalarSheet.addRow([escapeExcelCell(topic), escapeExcelCell(explanation)]);
    }

    const arrayBuffer = await workbook.xlsx.writeBuffer();
    const buffer = Buffer.from(arrayBuffer);

    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": 'attachment; filename="eczane-ice-aktarma-sablonu.xlsx"',
      },
    });
  } catch (error) {
    logger.error(
      "pharmacy_import_template_export_failed",
      { requestId: await getRequestId(), userId: user.id },
      error
    );
    return NextResponse.json(
      { message: "Excel şablonu oluşturulurken bir hata oluştu." },
      { status: 500 }
    );
  }
}
