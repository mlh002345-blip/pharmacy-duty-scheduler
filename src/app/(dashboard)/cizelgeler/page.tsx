import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ListBanner } from "@/components/layout/list-banner";
import { DeleteButton } from "@/components/layout/delete-button";
import { prisma } from "@/lib/prisma";
import { getTurkishMonthName } from "@/lib/scheduling/date-tr";
import { deleteDutyScheduleAction } from "./actions";

export const dynamic = "force-dynamic";

const STATUS_LABELS: Record<string, string> = {
  DRAFT: "Taslak",
  PUBLISHED: "Yayınlandı",
};

export default async function CizelgelerPage({
  searchParams,
}: {
  searchParams: Promise<{ success?: string; error?: string }>;
}) {
  const { success, error } = await searchParams;

  const schedules = await prisma.dutySchedule.findMany({
    include: { region: true, _count: { select: { assignments: true } } },
    orderBy: [{ year: "desc" }, { month: "desc" }, { createdAt: "desc" }],
  });

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Nöbet Çizelgeleri</h1>
          <p className="text-muted-foreground text-sm">
            Aylık nöbet çizelgeleri ve atamalar.
          </p>
        </div>
        <Button asChild>
          <Link href="/cizelgeler/yeni">Yeni Ekle</Link>
        </Button>
      </div>

      <ListBanner success={success} error={error} />

      <Card>
        <CardHeader>
          <CardTitle>Çizelge Listesi</CardTitle>
          <CardDescription>{schedules.length} kayıt.</CardDescription>
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
                  <TableHead>Çizelge Adı</TableHead>
                  <TableHead>Bölge</TableHead>
                  <TableHead>Ay/Yıl</TableHead>
                  <TableHead>Durum</TableHead>
                  <TableHead>Oluşturulma Tarihi</TableHead>
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
                    <TableCell>
                      <Badge variant={schedule.status === "DRAFT" ? "secondary" : "default"}>
                        {STATUS_LABELS[schedule.status] ?? schedule.status}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {schedule.createdAt.toLocaleDateString("tr-TR")}
                    </TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-2">
                        <Button variant="outline" size="sm" asChild>
                          <Link href={`/cizelgeler/${schedule.id}`}>Görüntüle</Link>
                        </Button>
                        {schedule.status === "DRAFT" && (
                          <DeleteButton
                            action={deleteDutyScheduleAction.bind(null, schedule.id)}
                            confirmMessage={`${schedule.region.name} ${getTurkishMonthName(schedule.month)} ${schedule.year} çizelgesini silmek istediğinize emin misiniz?`}
                          />
                        )}
                      </div>
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
