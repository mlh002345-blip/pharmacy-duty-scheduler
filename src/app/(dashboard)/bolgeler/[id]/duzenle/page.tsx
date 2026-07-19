import { notFound } from "next/navigation";

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { prisma } from "@/lib/prisma";
import { requireOrganizationRoleOrRedirect } from "@/lib/auth/tenant";
import { RegionForm } from "../../region-form";
import { updateRegionAction } from "../../actions";
import { ServiceAreaManager } from "./service-area-manager";

export default async function BolgeDuzenlePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireOrganizationRoleOrRedirect("manageRegions", "/bolgeler");
  const { id } = await params;
  const region = await prisma.region.findFirst({ where: { id, organizationId: user.organizationId } });
  if (!region) notFound();

  const serviceAreas = await prisma.serviceArea.findMany({
    where: { regionId: id },
    select: { id: true, name: true, _count: { select: { pharmacies: true } } },
    orderBy: { name: "asc" },
  });

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

      <Card>
        <CardHeader>
          <CardTitle>Hizmet Alanları</CardTitle>
          <CardDescription>
            Bu bölge içindeki eczaneleri konuma göre gruplamak için (örn.
            &quot;Üniversite Yakını&quot;) — eczane formunda etiketlenebilir, V2
            rotasyon havuzlarını toplu doldurmak için kullanılabilir.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ServiceAreaManager
            regionId={id}
            serviceAreas={serviceAreas.map((area) => ({
              id: area.id,
              name: area.name,
              pharmacyCount: area._count.pharmacies,
            }))}
          />
        </CardContent>
      </Card>
    </div>
  );
}
