import { notFound } from "next/navigation";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { prisma } from "@/lib/prisma";
import { requireOrganizationRoleOrRedirect } from "@/lib/auth/tenant";
import { RegionForm } from "../../region-form";
import { updateRegionAction } from "../../actions";

export default async function BolgeDuzenlePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireOrganizationRoleOrRedirect("manageRegions", "/bolgeler");
  const { id } = await params;
  const region = await prisma.region.findFirst({ where: { id, organizationId: user.organizationId } });
  if (!region) notFound();

  const action = updateRegionAction.bind(null, id);

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">Bölgeyi Düzenle</h1>
      <Card>
        <CardHeader>
          <CardTitle>Bölge Bilgileri</CardTitle>
        </CardHeader>
        <CardContent>
          <RegionForm action={action} region={region} />
        </CardContent>
      </Card>
    </div>
  );
}
