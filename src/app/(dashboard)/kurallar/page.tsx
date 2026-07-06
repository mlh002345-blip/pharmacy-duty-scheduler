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
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth/session";
import { hasPermission } from "@/lib/auth/permissions";

export const dynamic = "force-dynamic";

export default async function KurallarPage({
  searchParams,
}: {
  searchParams: Promise<{ success?: string; error?: string }>;
}) {
  const { success, error } = await searchParams;

  const user = await getCurrentUser();
  const canManage = !!user && hasPermission(user.role, "manageSetupData");

  const regions = await prisma.region.findMany({
    include: { dutyRule: true },
    orderBy: { name: "asc" },
  });

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Nöbet Kuralları</h1>
        <p className="text-muted-foreground text-sm">
          Her bölge için asgari nöbet aralığı ve gün ağırlıkları.
        </p>
      </div>

      <ListBanner success={success} error={error} />

      <Card>
        <CardHeader>
          <CardTitle>Bölge Bazlı Kurallar</CardTitle>
          <CardDescription>
            Her bölgenin tek bir aktif kural setine sahip olması önerilir.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Bölge</TableHead>
                <TableHead>Min. Gün Aralığı</TableHead>
                <TableHead>Hafta İçi</TableHead>
                <TableHead>Cumartesi</TableHead>
                <TableHead>Pazar</TableHead>
                <TableHead>Resmi Tatil</TableHead>
                <TableHead>Dini Bayram</TableHead>
                <TableHead>Durum</TableHead>
                <TableHead className="text-right">İşlemler</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {regions.map((region) => (
                <TableRow key={region.id}>
                  <TableCell className="font-medium">{region.name}</TableCell>
                  <TableCell>{region.dutyRule?.minDaysBetweenDuties ?? "-"}</TableCell>
                  <TableCell>{region.dutyRule?.weekdayWeight ?? "-"}</TableCell>
                  <TableCell>{region.dutyRule?.saturdayWeight ?? "-"}</TableCell>
                  <TableCell>{region.dutyRule?.sundayWeight ?? "-"}</TableCell>
                  <TableCell>{region.dutyRule?.officialHolidayWeight ?? "-"}</TableCell>
                  <TableCell>{region.dutyRule?.religiousHolidayWeight ?? "-"}</TableCell>
                  <TableCell>
                    <Badge variant={region.dutyRule ? "default" : "secondary"}>
                      {region.dutyRule ? "Tanımlı" : "Tanımsız"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    {canManage ? (
                      <Button variant="outline" size="sm" asChild>
                        <Link href={`/kurallar/${region.id}/duzenle`}>
                          {region.dutyRule ? "Düzenle" : "Kural Oluştur"}
                        </Link>
                      </Button>
                    ) : (
                      <span className="text-muted-foreground text-sm">-</span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
              {regions.length === 0 && (
                <TableRow>
                  <TableCell colSpan={9} className="text-muted-foreground text-center">
                    Henüz tanımlı bir bölge bulunmuyor.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
