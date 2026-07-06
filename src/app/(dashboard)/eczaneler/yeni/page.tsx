import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { prisma } from "@/lib/prisma";
import { requirePermissionOrRedirect } from "@/lib/auth/guard";
import { PharmacyForm } from "../pharmacy-form";
import { createPharmacyAction } from "../actions";

export default async function YeniEczanePage() {
  await requirePermissionOrRedirect("manageSetupData", "/eczaneler");
  const regions = await prisma.region.findMany({ orderBy: { name: "asc" } });

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">Yeni Eczane Ekle</h1>
      <Card>
        <CardHeader>
          <CardTitle>Eczane Bilgileri</CardTitle>
        </CardHeader>
        <CardContent>
          <PharmacyForm action={createPharmacyAction} regions={regions} />
        </CardContent>
      </Card>
    </div>
  );
}
