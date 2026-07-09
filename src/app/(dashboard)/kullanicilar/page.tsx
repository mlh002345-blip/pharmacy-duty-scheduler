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
import { StatusToggleButton } from "@/components/layout/status-toggle-button";
import { Pagination, DEFAULT_PAGE_SIZE, parsePageParam } from "@/components/layout/pagination";
import { prisma } from "@/lib/prisma";
import { requirePermissionOrRedirectWithMessage } from "@/lib/auth/guard";
import { ROLE_LABELS } from "@/lib/auth/permissions";
import { setUserStatusAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function KullanicilarPage({
  searchParams,
}: {
  searchParams: Promise<{ success?: string; error?: string; page?: string }>;
}) {
  const currentUser = await requirePermissionOrRedirectWithMessage(
    "manageUsers",
    "/",
    "Bu sayfaya erişim yetkiniz bulunmuyor."
  );
  const { success, error, page: pageParam } = await searchParams;
  const page = parsePageParam(pageParam);

  const [users, totalCount] = await Promise.all([
    prisma.user.findMany({
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        isActive: true,
        createdAt: true,
      },
      orderBy: { name: "asc" },
      skip: (page - 1) * DEFAULT_PAGE_SIZE,
      take: DEFAULT_PAGE_SIZE,
    }),
    prisma.user.count(),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Kullanıcılar</h1>
          <p className="text-muted-foreground text-sm">
            Sisteme erişebilen kullanıcılar ve rolleri.
          </p>
        </div>
        <Button asChild>
          <Link href="/kullanicilar/yeni">Yeni Ekle</Link>
        </Button>
      </div>

      <ListBanner success={success} error={error} />

      <Card>
        <CardHeader>
          <CardTitle>Kullanıcı Listesi</CardTitle>
          <CardDescription>{totalCount} kayıt.</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Ad Soyad</TableHead>
                <TableHead>E-posta</TableHead>
                <TableHead>Rol</TableHead>
                <TableHead>Durum</TableHead>
                <TableHead>Oluşturulma Tarihi</TableHead>
                <TableHead className="text-right">İşlemler</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.map((user) => (
                <TableRow key={user.id}>
                  <TableCell className="font-medium">{user.name}</TableCell>
                  <TableCell>{user.email}</TableCell>
                  <TableCell>{ROLE_LABELS[user.role]}</TableCell>
                  <TableCell>
                    <Badge variant={user.isActive ? "success" : "secondary"}>
                      {user.isActive ? "Aktif" : "Pasif"}
                    </Badge>
                  </TableCell>
                  <TableCell>{user.createdAt.toLocaleDateString("tr-TR")}</TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-2">
                      <Button variant="outline" size="sm" asChild>
                        <Link href={`/kullanicilar/${user.id}/duzenle`}>Düzenle</Link>
                      </Button>
                      {user.id === currentUser.id ? (
                        <span className="text-muted-foreground self-center text-sm">
                          Kendi hesabınız
                        </span>
                      ) : (
                        <StatusToggleButton
                          action={setUserStatusAction.bind(null, user.id, !user.isActive)}
                          isActive={user.isActive}
                        />
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
              {users.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="text-muted-foreground text-center">
                    Henüz tanımlı bir kullanıcı bulunmuyor.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
          <Pagination
            basePath="/kullanicilar"
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
