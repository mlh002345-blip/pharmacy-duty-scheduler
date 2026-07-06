import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
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

const HOLIDAY_TYPE_LABELS: Record<string, string> = {
  OFFICIAL: "Resmi Tatil",
  RELIGIOUS: "Dini Bayram",
};

export default async function TatilGunleriPage() {
  const holidays = await prisma.holiday.findMany({ orderBy: { date: "asc" } });

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Tatil Günleri</h1>
        <p className="text-muted-foreground text-sm">
          Resmi ve dini bayram günleri, nöbet ağırlık hesabında kullanılır.
        </p>
      </div>

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
              </TableRow>
            </TableHeader>
            <TableBody>
              {holidays.map((holiday) => (
                <TableRow key={holiday.id}>
                  <TableCell>
                    {holiday.date.toLocaleDateString("tr-TR")}
                  </TableCell>
                  <TableCell className="font-medium">{holiday.name}</TableCell>
                  <TableCell>
                    <Badge variant="outline">
                      {HOLIDAY_TYPE_LABELS[holiday.type] ?? holiday.type}
                    </Badge>
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
