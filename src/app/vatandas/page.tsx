import { Card, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";

export default function VatandasEkraniPage() {
  return (
    <div className="mx-auto flex min-h-screen w-full max-w-2xl flex-col items-center justify-center gap-6 p-6">
      <div className="text-center">
        <h1 className="text-3xl font-semibold">Nöbetçi Eczaneler</h1>
        <p className="text-muted-foreground mt-2 text-sm">
          Bugün nöbetçi olan eczaneleri buradan görüntüleyebilirsiniz.
        </p>
      </div>

      <Card className="w-full">
        <CardHeader>
          <CardTitle>Bugünün Nöbetçi Eczaneleri</CardTitle>
          <CardDescription>
            Nöbet çizelgesi henüz oluşturulmadı. Çizelgeleme özelliği eklendiğinde
            bugünün nöbetçi eczaneleri burada listelenecektir.
          </CardDescription>
        </CardHeader>
      </Card>
    </div>
  );
}
