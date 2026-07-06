import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth/session";
import { hasPermission } from "@/lib/auth/permissions";

export const dynamic = "force-dynamic";

export default async function PanelPage() {
  const user = await getCurrentUser();
  const canGenerate = !!user && hasPermission(user.role, "generateSchedule");

  const [
    pharmacyCount,
    activePharmacyCount,
    regionCount,
    holidayCount,
    unavailabilityCount,
    draftScheduleCount,
    publishedScheduleCount,
  ] = await Promise.all([
    prisma.pharmacy.count(),
    prisma.pharmacy.count({ where: { isActive: true } }),
    prisma.region.count(),
    prisma.holiday.count(),
    prisma.unavailability.count(),
    prisma.dutySchedule.count({ where: { status: "DRAFT" } }),
    prisma.dutySchedule.count({ where: { status: "PUBLISHED" } }),
  ]);

  const stats = [
    { label: "Toplam Eczane", value: pharmacyCount },
    { label: "Aktif Eczane", value: activePharmacyCount },
    { label: "Nöbet Bölgesi", value: regionCount },
    { label: "Tanımlı Tatil Günü", value: holidayCount },
    { label: "Mazeret Kaydı", value: unavailabilityCount },
    { label: "Taslak Çizelge", value: draftScheduleCount },
    { label: "Yayındaki Çizelge", value: publishedScheduleCount },
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
          <CardTitle>Hızlı İşlemler</CardTitle>
          <CardDescription>Sık kullanılan sayfalara buradan ulaşabilirsiniz.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          {canGenerate && (
            <Button asChild>
              <Link href="/cizelgeler/yeni">Yeni Nöbet Çizelgesi Oluştur</Link>
            </Button>
          )}
          <Button variant="outline" asChild>
            <Link href="/cizelgeler">Nöbet Çizelgeleri</Link>
          </Button>
          <Button variant="outline" asChild>
            <Link href="/eczaneler">Eczaneler</Link>
          </Button>
          <Button variant="outline" asChild>
            <Link href="/denetim-kayitlari">Denetim Kayıtları</Link>
          </Button>
        </CardContent>
      </Card>

      {draftScheduleCount > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              Yayınlanmayı Bekleyen Çizelgeler
              <Badge variant="secondary">{draftScheduleCount}</Badge>
            </CardTitle>
            <CardDescription>
              Taslak durumundaki çizelgeleri gözden geçirip yayınlamayı unutmayın.
            </CardDescription>
          </CardHeader>
        </Card>
      )}
    </div>
  );
}
