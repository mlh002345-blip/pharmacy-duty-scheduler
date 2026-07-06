import { Card, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export default async function PanelPage() {
  const [pharmacyCount, activePharmacyCount, regionCount, holidayCount, unavailabilityCount] =
    await Promise.all([
      prisma.pharmacy.count(),
      prisma.pharmacy.count({ where: { isActive: true } }),
      prisma.region.count(),
      prisma.holiday.count(),
      prisma.unavailability.count(),
    ]);

  const stats = [
    { label: "Toplam Eczane", value: pharmacyCount },
    { label: "Aktif Eczane", value: activePharmacyCount },
    { label: "Nöbet Bölgesi", value: regionCount },
    { label: "Tanımlı Tatil Günü", value: holidayCount },
    { label: "Mazeret Kaydı", value: unavailabilityCount },
  ];

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Panel</h1>
        <p className="text-muted-foreground text-sm">
          Nöbet çizelgeleme sisteminin genel durumu.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {stats.map((stat) => (
          <Card key={stat.label}>
            <CardHeader>
              <CardDescription>{stat.label}</CardDescription>
              <CardTitle className="text-3xl">{stat.value}</CardTitle>
            </CardHeader>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Nöbet Çizelgesi Oluşturma</CardTitle>
          <CardDescription>
            Otomatik nöbet çizelgesi oluşturma algoritması henüz devreye alınmadı.
            Bu özellik ayrı bir geliştirme adımında eklenecektir.
          </CardDescription>
        </CardHeader>
      </Card>
    </div>
  );
}
