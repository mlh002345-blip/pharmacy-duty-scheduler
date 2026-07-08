import { notFound } from "next/navigation";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { prisma } from "@/lib/prisma";
import { requirePermissionOrRedirectWithMessage } from "@/lib/auth/guard";
import { UserForm } from "../../user-form";
import { updateUserAction } from "../../actions";

export default async function KullaniciDuzenlePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requirePermissionOrRedirectWithMessage(
    "manageUsers",
    "/",
    "Bu sayfaya erişim yetkiniz bulunmuyor."
  );
  const { id } = await params;
  const user = await prisma.user.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      isActive: true,
    },
  });
  if (!user) notFound();

  const action = updateUserAction.bind(null, id);

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">Kullanıcıyı Düzenle</h1>
      <Card>
        <CardHeader>
          <CardTitle>Kullanıcı Bilgileri</CardTitle>
        </CardHeader>
        <CardContent>
          <UserForm action={action} user={user} />
        </CardContent>
      </Card>
    </div>
  );
}
