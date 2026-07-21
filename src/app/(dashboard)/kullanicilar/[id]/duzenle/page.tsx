import { notFound } from "next/navigation";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { prisma } from "@/lib/prisma";
import { requireOrganizationRoleOrRedirect } from "@/lib/auth/tenant";
import { UserForm } from "../../user-form";
import { updateUserAction } from "../../actions";

export default async function KullaniciDuzenlePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const currentUser = await requireOrganizationRoleOrRedirect(
    "manageUsers",
    "/panel",
    "Bu sayfaya erişim yetkiniz bulunmuyor."
  );
  const { id } = await params;
  const user = await prisma.user.findFirst({
    where: { id, organizationId: currentUser.organizationId },
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
