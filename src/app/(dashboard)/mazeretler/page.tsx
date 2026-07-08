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
import { Pagination, DEFAULT_PAGE_SIZE, parsePageParam } from "@/components/layout/pagination";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth/session";
import { hasPermission } from "@/lib/auth/permissions";
import { deleteUnavailabilityAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function MazeretlerPage({
  searchParams,
}: {
  searchParams: Promise<{ success?: string; error?: string; page?: string }>;
}) {
  const { success, error, page: pageParam } = await searchParams;

  const user = await getCurrentUser();
  const canManage = !!user && hasPermission(user.role, "manageSetupData");

  const page = parsePageParam(pageParam);

  const [unavailabilities, totalCount] = await Promise.all([
    prisma.unavailability.findMany({
      select: {
        id: true,
        startDate: true,
        endDate: true,
        reason: true,
        pharmacy: { select: { name: true } },
      },
      orderBy: { startDate: "asc" },
      skip: (page - 1) * DEFAULT_PAGE_SIZE,
      take: DEFAULT_PAGE_SIZE,
    }),
    prisma.unavailability.count(),
  ]);

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
          <CardDescription>{totalCount} kayıt.</CardDescription>
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
              {unavailabilities.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="text-muted-foreground text-center">
                    Henüz tanımlı bir mazeret kaydı bulunmuyor.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
          <Pagination
            basePath="/mazeretler"
            searchParams={{}}
            page={page}
            pageSize={DEFAULT_PAGE_SIZE}
            totalCount={totalCount}
          />
        </CardContent>
      </Card>
    </div>
  );
}
