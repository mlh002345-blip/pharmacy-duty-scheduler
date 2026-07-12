import { notFound } from "next/navigation";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { prisma } from "@/lib/prisma";
import { requireOrganizationRoleOrRedirect } from "@/lib/auth/tenant";
import { UnavailabilityForm } from "../../unavailability-form";
import { updateUnavailabilityAction } from "../../actions";

export default async function MazeretDuzenlePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireOrganizationRoleOrRedirect("manageSetupData", "/mazeretler");
  const { id } = await params;
  const [unavailability, pharmacies] = await Promise.all([
    prisma.unavailability.findFirst({
      where: { id, pharmacy: { region: { organizationId: user.organizationId } } },
    }),
    prisma.pharmacy.findMany({
      where: { region: { organizationId: user.organizationId } },
      include: { region: true },
      orderBy: { name: "asc" },
    }),
  ]);
  if (!unavailability) notFound();

  const action = updateUnavailabilityAction.bind(null, id);

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">Mazeret Kaydını Düzenle</h1>
      <Card>
        <CardHeader>
          <CardTitle>Mazeret Bilgileri</CardTitle>
        </CardHeader>
        <CardContent>
          <UnavailabilityForm
            action={action}
            unavailability={unavailability}
            pharmacies={pharmacies}
          />
        </CardContent>
      </Card>
    </div>
  );
}
