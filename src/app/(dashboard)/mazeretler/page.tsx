import Link from "next/link";

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
import { getCurrentUser } from "@/lib/auth/session";
import { hasPermission } from "@/lib/auth/permissions";
import { deleteUnavailabilityAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function MazeretlerPage({
  searchParams,
}: {
  searchParams: Promise<{ success?: string; error?: string }>;
}) {
  const { success, error } = await searchParams;

  const user = await getCurrentUser();
  const canManage = !!user && hasPermission(user.role, "manageSetupData");

  const unavailabilities = await prisma.unavailability.findMany({
    include: { pharmacy: true },
    orderBy: { startDate: "asc" },
  });

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Mazeretler</h1>
          <p className="text-muted-foreground text-sm">
            Eczanelerin nöbet tutamayacağı tarih aralıkları.
          </p>
        </div>
        {canManage && (
          <Button asChild>
            <Link href="/mazeretler/yeni">Yeni Ekle</Link>
          </Button>
        )}
      </div>

      <ListBanner success={success} error={error} />

      <Card>
        <CardHeader>
          <CardTitle>Mazeret Listesi</CardTitle>
          <CardDescription>{unavailabilities.length} kayıt.</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Eczane</TableHead>
                <TableHead>Başlangıç</TableHead>
                <TableHead>Bitiş</TableHead>
                <TableHead>Açıklama</TableHead>
                <TableHead className="text-right">İşlemler</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {unavailabilities.map((item) => (
                <TableRow key={item.id}>
                  <TableCell className="font-medium">{item.pharmacy.name}</TableCell>
                  <TableCell>{item.startDate.toLocaleDateString("tr-TR")}</TableCell>
                  <TableCell>{item.endDate.toLocaleDateString("tr-TR")}</TableCell>
                  <TableCell>{item.reason ?? "-"}</TableCell>
                  <TableCell>
                    {canManage ? (
                      <div className="flex justify-end gap-2">
                        <Button variant="outline" size="sm" asChild>
                          <Link href={`/mazeretler/${item.id}/duzenle`}>Düzenle</Link>
                        </Button>
                        <DeleteButton
                          action={deleteUnavailabilityAction.bind(null, item.id)}
                          confirmMessage={`"${item.pharmacy.name}" eczanesine ait mazeret kaydını silmek istediğinize emin misiniz?`}
                        />
                      </div>
                    ) : (
                      <div className="text-muted-foreground text-right text-sm">-</div>
                    )}
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
