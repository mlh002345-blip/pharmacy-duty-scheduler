import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { prisma } from "@/lib/prisma";
import { requireOrganizationRoleOrRedirect } from "@/lib/auth/tenant";
import { UnavailabilityForm } from "../unavailability-form";
import { createUnavailabilityAction } from "../actions";

export default async function YeniMazeretPage() {
  const user = await requireOrganizationRoleOrRedirect("manageSetupData", "/mazeretler");
  const pharmacies = await prisma.pharmacy.findMany({
    where: { region: { organizationId: user.organizationId } },
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
