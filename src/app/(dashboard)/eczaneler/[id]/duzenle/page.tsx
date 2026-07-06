import { notFound } from "next/navigation";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { prisma } from "@/lib/prisma";
import { requirePermissionOrRedirect } from "@/lib/auth/guard";
import { PharmacyForm } from "../../pharmacy-form";
import { updatePharmacyAction } from "../../actions";

export default async function EczaneDuzenlePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requirePermissionOrRedirect("manageSetupData", "/eczaneler");
  const { id } = await params;
  const [pharmacy, regions] = await Promise.all([
    prisma.pharmacy.findUnique({ where: { id } }),
    prisma.region.findMany({ orderBy: { name: "asc" } }),
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
    </div>
  );
}
