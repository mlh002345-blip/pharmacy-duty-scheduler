import Link from "next/link";
import { Download } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { requireOrganizationRoleOrRedirect } from "@/lib/auth/tenant";
import { ImportUploadForm } from "./import-upload-form";

export default async function EczaneIceAktarPage() {
  await requireOrganizationRoleOrRedirect(
    "importPharmacies",
    "/eczaneler",
    "Bu sayfaya erişim yetkiniz bulunmuyor."
  );

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Excel ile Eczane İçe Aktar</h1>
        <p className="text-muted-foreground text-sm">
          Şablonu indirin, doldurun ve yükleyin. Aktarım öncesi bir önizleme ve doğrulama
          adımından geçer; hiçbir satır düzeltilmeden aktarım yapılamaz.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>1. Şablon İndir</CardTitle>
          <CardDescription>
            Beklenen sütunlar ve kabul edilen değerler için Açıklamalar sayfasını içerir.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant="outline" asChild>
            <a href="/eczaneler/ice-aktar/sablon">
              <Download className="size-4" />
              Şablonu İndir
            </a>
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>2. Dosya Yükle</CardTitle>
          <CardDescription>
            Yalnızca .xlsx dosyaları kabul edilir. En fazla 5 MB ve 5.000 satır.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ImportUploadForm />
        </CardContent>
      </Card>

      <Button variant="ghost" asChild className="w-fit">
        <Link href="/eczaneler">Eczanelere Dön</Link>
      </Button>
    </div>
  );
}
