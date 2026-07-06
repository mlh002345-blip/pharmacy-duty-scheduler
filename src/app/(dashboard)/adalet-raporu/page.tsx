import { Card, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";

export default function AdaletRaporuPage() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Adalet Raporu</h1>
        <p className="text-muted-foreground text-sm">
          Eczaneler arası nöbet yükü dağılımının adalet analizi.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Rapor Henüz Hazır Değil</CardTitle>
          <CardDescription>
            Adalet raporu, otomatik nöbet çizelgesi oluşturma algoritması eklendikten
            sonra nöbet yüklerine göre hesaplanacaktır.
          </CardDescription>
        </CardHeader>
      </Card>
    </div>
  );
}
