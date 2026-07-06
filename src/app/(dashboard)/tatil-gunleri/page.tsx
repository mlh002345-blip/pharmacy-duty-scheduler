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
import { HOLIDAY_TYPE_LABELS } from "@/lib/validations/holiday";
import { deleteHolidayAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function TatilGunleriPage({
  searchParams,
}: {
  searchParams: Promise<{ success?: string; error?: string }>;
}) {
  const { success, error } = await searchParams;
  const holidays = await prisma.holiday.findMany({ orderBy: { date: "asc" } });

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Tatil Günleri</h1>
          <p className="text-muted-foreground text-sm">
            Resmi ve dini bayram günleri, nöbet ağırlık hesabında kullanılır.
          </p>
        </div>
        <Button asChild>
          <Link href="/tatil-gunleri/yeni">Yeni Ekle</Link>
        </Button>
      </div>

      <ListBanner success={success} error={error} />

      <Card>
        <CardHeader>
          <CardTitle>Tatil Günü Listesi</CardTitle>
          <CardDescription>{holidays.length} kayıt.</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Tarih</TableHead>
                <TableHead>Adı</TableHead>
                <TableHead>Türü</TableHead>
                <TableHead className="text-right">İşlemler</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {holidays.map((holiday) => (
                <TableRow key={holiday.id}>
                  <TableCell>{holiday.date.toLocaleDateString("tr-TR")}</TableCell>
                  <TableCell className="font-medium">{holiday.name}</TableCell>
                  <TableCell>
                    <Badge variant="outline">
                      {HOLIDAY_TYPE_LABELS[holiday.type] ?? holiday.type}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-2">
                      <Button variant="outline" size="sm" asChild>
                        <Link href={`/tatil-gunleri/${holiday.id}/duzenle`}>Düzenle</Link>
                      </Button>
                      <DeleteButton
                        action={deleteHolidayAction.bind(null, holiday.id)}
                        confirmMessage={`"${holiday.name}" tatil gününü silmek istediğinize emin misiniz?`}
                      />
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
