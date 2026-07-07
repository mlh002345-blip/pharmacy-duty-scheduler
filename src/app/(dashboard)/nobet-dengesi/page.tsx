import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { prisma } from "@/lib/prisma";
import { getTurkishMonthName } from "@/lib/scheduling/date-tr";

export const dynamic = "force-dynamic";

export default async function NobetDengesiPage() {
  const schedules = await prisma.dutySchedule.findMany({
    include: { region: true, _count: { select: { assignments: true } } },
    orderBy: [{ year: "desc" }, { month: "desc" }, { createdAt: "desc" }],
  });

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Nöbet Yükü Analizi</h1>
        <p className="text-muted-foreground text-sm">
          Eczaneler arasındaki nöbet dağılımını, toplam nöbet yükünü ve manuel değişikliklerin dengeye etkisini izleyin.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Çizelge Bazlı Nöbet Dengesi</CardTitle>
          <CardDescription>
            Her nöbet çizelgesinin nöbet yükü analizi, ilgili çizelgenin detay
            sayfasındaki &quot;Nöbet Dengesi&quot; bölümünde görüntülenebilir. Genel
            (tüm dönemleri kapsayan) analiz ileride eklenebilir.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {schedules.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              Henüz oluşturulmuş bir nöbet çizelgesi bulunmuyor.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Çizelge</TableHead>
                  <TableHead>Bölge</TableHead>
                  <TableHead>Ay/Yıl</TableHead>
                  <TableHead>Nöbet Ataması</TableHead>
                  <TableHead className="text-right">İşlemler</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {schedules.map((schedule) => (
                  <TableRow key={schedule.id}>
                    <TableCell className="font-medium">
                      {schedule.region.name} {getTurkishMonthName(schedule.month)}{" "}
                      {schedule.year} Nöbet Çizelgesi
                    </TableCell>
                    <TableCell>{schedule.region.name}</TableCell>
                    <TableCell>
                      {getTurkishMonthName(schedule.month)} {schedule.year}
                    </TableCell>
                    <TableCell>{schedule._count.assignments}</TableCell>
                    <TableCell className="text-right">
                      <Button variant="outline" size="sm" asChild>
                        <Link href={`/cizelgeler/${schedule.id}#nobet-dengesi`}>
                          Analizi Görüntüle
                        </Link>
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
