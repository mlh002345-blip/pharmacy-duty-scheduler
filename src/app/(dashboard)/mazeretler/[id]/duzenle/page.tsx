import { notFound } from "next/navigation";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { prisma } from "@/lib/prisma";
import { requirePermissionOrRedirect } from "@/lib/auth/guard";
import { UnavailabilityForm } from "../../unavailability-form";
import { updateUnavailabilityAction } from "../../actions";

export default async function MazeretDuzenlePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requirePermissionOrRedirect("manageSetupData", "/mazeretler");
  const { id } = await params;
  const [unavailability, pharmacies] = await Promise.all([
    prisma.unavailability.findUnique({ where: { id } }),
    prisma.pharmacy.findMany({ include: { region: true }, orderBy: { name: "asc" } }),
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
