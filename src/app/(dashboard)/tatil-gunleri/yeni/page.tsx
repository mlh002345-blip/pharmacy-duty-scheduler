import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requirePermissionOrRedirect } from "@/lib/auth/guard";
import { HolidayForm } from "../holiday-form";
import { createHolidayAction } from "../actions";

export default async function YeniTatilGunuPage() {
  await requirePermissionOrRedirect("manageSetupData", "/tatil-gunleri");

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">Yeni Tatil Günü Ekle</h1>
      <Card>
        <CardHeader>
          <CardTitle>Tatil Günü Bilgileri</CardTitle>
        </CardHeader>
        <CardContent>
          <HolidayForm action={createHolidayAction} />
        </CardContent>
      </Card>
    </div>
  );
}
