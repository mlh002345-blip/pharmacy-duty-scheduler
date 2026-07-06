import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { prisma } from "@/lib/prisma";
import { requirePermissionOrRedirect } from "@/lib/auth/guard";
import { DutyScheduleForm } from "../duty-schedule-form";

export default async function YeniCizelgePage() {
  await requirePermissionOrRedirect("generateSchedule", "/cizelgeler");
  const regions = await prisma.region.findMany({
    where: { isActive: true },
    orderBy: { name: "asc" },
  });

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">Nöbet Çizelgesi Oluştur</h1>
      <Card>
        <CardHeader>
          <CardTitle>Çizelge Bilgileri</CardTitle>
          <CardDescription>
            Seçilen bölge ve ay için nöbet çizelgesi taslak olarak oluşturulur.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <DutyScheduleForm regions={regions} />
        </CardContent>
      </Card>
    </div>
  );
}
