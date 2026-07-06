import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { prisma } from "@/lib/prisma";
import { requirePermissionOrRedirect } from "@/lib/auth/guard";
import { UnavailabilityForm } from "../unavailability-form";
import { createUnavailabilityAction } from "../actions";

export default async function YeniMazeretPage() {
  await requirePermissionOrRedirect("manageSetupData", "/mazeretler");
  const pharmacies = await prisma.pharmacy.findMany({
    include: { region: true },
    orderBy: { name: "asc" },
  });

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">Yeni Mazeret Ekle</h1>
      <Card>
        <CardHeader>
          <CardTitle>Mazeret Bilgileri</CardTitle>
        </CardHeader>
        <CardContent>
          <UnavailabilityForm action={createUnavailabilityAction} pharmacies={pharmacies} />
        </CardContent>
      </Card>
    </div>
  );
}
