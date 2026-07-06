import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requirePermissionOrRedirect } from "@/lib/auth/guard";
import { RegionForm } from "../region-form";
import { createRegionAction } from "../actions";

export default async function YeniBolgePage() {
  await requirePermissionOrRedirect("manageSetupData", "/bolgeler");

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">Yeni Bölge Ekle</h1>
      <Card>
        <CardHeader>
          <CardTitle>Bölge Bilgileri</CardTitle>
        </CardHeader>
        <CardContent>
          <RegionForm action={createRegionAction} />
        </CardContent>
      </Card>
    </div>
  );
}
