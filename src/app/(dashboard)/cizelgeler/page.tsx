import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

const STATUS_LABELS: Record<string, string> = {
  DRAFT: "Taslak",
  PUBLISHED: "Yayınlandı",
};

export default async function CizelgelerPage() {
  const schedules = await prisma.dutySchedule.findMany({
    include: { _count: { select: { assignments: true } } },
    orderBy: [{ year: "desc" }, { month: "desc" }],
  });

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Nöbet Çizelgeleri</h1>
          <p className="text-muted-foreground text-sm">
            Aylık nöbet çizelgeleri ve atamalar.
          </p>
        </div>
        <Button disabled title="Otomatik çizelge oluşturma henüz eklenmedi">
          Yeni Çizelge Oluştur
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Çizelge Listesi</CardTitle>
          <CardDescription>
            Otomatik nöbet çizelgesi oluşturma algoritması henüz devreye alınmadı.
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
                  <TableHead>Ay</TableHead>
                  <TableHead>Yıl</TableHead>
                  <TableHead>Durum</TableHead>
                  <TableHead>Atama Sayısı</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {schedules.map((schedule) => (
                  <TableRow key={schedule.id}>
                    <TableCell>{schedule.month}</TableCell>
                    <TableCell>{schedule.year}</TableCell>
                    <TableCell>{STATUS_LABELS[schedule.status] ?? schedule.status}</TableCell>
                    <TableCell>{schedule._count.assignments}</TableCell>
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
