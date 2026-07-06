import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export default async function KurallarPage() {
  const rules = await prisma.dutyRule.findMany({
    include: { region: true },
    orderBy: { name: "asc" },
  });

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Nöbet Kuralları</h1>
        <p className="text-muted-foreground text-sm">
          Bölge bazlı nöbet ağırlıkları ve asgari nöbet aralığı kuralları.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Kural Listesi</CardTitle>
          <CardDescription>
            Hafta içi, Cumartesi, Pazar, resmi ve dini bayram ağırlıkları.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Kural Adı</TableHead>
                <TableHead>Bölge</TableHead>
                <TableHead>Min. Gün Aralığı</TableHead>
                <TableHead>Hafta İçi</TableHead>
                <TableHead>Cumartesi</TableHead>
                <TableHead>Pazar</TableHead>
                <TableHead>Resmi Tatil</TableHead>
                <TableHead>Dini Bayram</TableHead>
                <TableHead>Durum</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rules.map((rule) => (
                <TableRow key={rule.id}>
                  <TableCell className="font-medium">{rule.name}</TableCell>
                  <TableCell>{rule.region.name}</TableCell>
                  <TableCell>{rule.minDaysBetweenDuties}</TableCell>
                  <TableCell>{rule.weekdayWeight}</TableCell>
                  <TableCell>{rule.saturdayWeight}</TableCell>
                  <TableCell>{rule.sundayWeight}</TableCell>
                  <TableCell>{rule.officialHolidayWeight}</TableCell>
                  <TableCell>{rule.religiousHolidayWeight}</TableCell>
                  <TableCell>
                    <Badge variant={rule.isActive ? "default" : "secondary"}>
                      {rule.isActive ? "Aktif" : "Pasif"}
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
