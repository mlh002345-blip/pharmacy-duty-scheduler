import { notFound } from "next/navigation";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { prisma } from "@/lib/prisma";
import { OrganizationEditForm } from "../../organization-edit-form";
import { updateOrganizationAction } from "../../actions";

export default async function KurumDuzenlePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const organization = await prisma.organization.findUnique({
    where: { id },
    select: { id: true, name: true, province: true, slug: true },
  });
  if (!organization) notFound();

  const action = updateOrganizationAction.bind(null, id);

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">Odayı Düzenle</h1>
      <Card>
        <CardHeader>
          <CardTitle>Oda Bilgileri</CardTitle>
        </CardHeader>
        <CardContent>
          <OrganizationEditForm action={action} organization={organization} />
        </CardContent>
      </Card>
    </div>
  );
}
