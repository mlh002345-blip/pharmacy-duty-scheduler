import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { prisma } from "@/lib/prisma";
import { requireOrganizationRoleOrRedirect } from "@/lib/auth/tenant";
import { PharmacyForm } from "../pharmacy-form";
import { createPharmacyAction } from "../actions";

export default async function YeniEczanePage() {
  const user = await requireOrganizationRoleOrRedirect("manageSetupData", "/eczaneler");
  const [regions, serviceAreas] = await Promise.all([
    prisma.region.findMany({
      where: { organizationId: user.organizationId },
      orderBy: { name: "asc" },
    }),
    prisma.serviceArea.findMany({
      where: { region: { organizationId: user.organizationId } },
      select: { id: true, name: true, regionId: true },
      orderBy: { name: "asc" },
    }),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">Yeni Eczane Ekle</h1>
      <Card>
        <CardHeader>
          <CardTitle>Eczane Bilgileri</CardTitle>
        </CardHeader>
        <CardContent>
          <PharmacyForm action={createPharmacyAction} regions={regions} serviceAreas={serviceAreas} />
        </CardContent>
      </Card>
    </div>
  );
}
