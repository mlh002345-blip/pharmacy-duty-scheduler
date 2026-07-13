import { notFound } from "next/navigation";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { prisma } from "@/lib/prisma";
import { requireOrganizationRoleOrRedirect } from "@/lib/auth/tenant";
import { PharmacyForm } from "../../pharmacy-form";
import { updatePharmacyAction } from "../../actions";

export default async function EczaneDuzenlePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireOrganizationRoleOrRedirect("manageSetupData", "/eczaneler");
  const { id } = await params;
  // Pharmacy has no direct organizationId column — ownership is derived
  // through region.organizationId. A cross-organization id must produce
  // the same notFound() as a truly-missing id, never another tenant's data.
  const [pharmacy, regions] = await Promise.all([
    prisma.pharmacy.findFirst({ where: { id, region: { organizationId: user.organizationId } } }),
    prisma.region.findMany({ where: { organizationId: user.organizationId }, orderBy: { name: "asc" } }),
  ]);
  if (!pharmacy) notFound();

  const action = updatePharmacyAction.bind(null, id);

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">Eczaneyi Düzenle</h1>
      <Card>
        <CardHeader>
          <CardTitle>Eczane Bilgileri</CardTitle>
        </CardHeader>
        <CardContent>
          <PharmacyForm action={action} pharmacy={pharmacy} regions={regions} />
        </CardContent>
      </Card>

      {pharmacy.requestToken && (
        <Card>
          <CardHeader>
            <CardTitle>Nöbet Talep Bağlantısı</CardTitle>
            <CardDescription>
              Bu bağlantıyı eczaneyle paylaşın; eczane, nöbet tutamama/tercih/değişiklik
              taleplerini giriş yapmadan bu form üzerinden iletebilir. Bağlantı eczaneye
              özeldir, üçüncü kişilerle paylaşılmamalıdır.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <code className="bg-muted block overflow-x-auto rounded-lg px-3 py-2 text-sm">
              /eczane-talep/{pharmacy.requestToken}
            </code>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
