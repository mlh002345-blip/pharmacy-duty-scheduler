import { notFound } from "next/navigation";

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { prisma } from "@/lib/prisma";
import { requirePermissionOrRedirect } from "@/lib/auth/guard";
import { DutyRuleForm } from "../../duty-rule-form";
import { upsertDutyRuleAction } from "../../actions";

export default async function KuralDuzenlePage({
  params,
}: {
  params: Promise<{ regionId: string }>;
}) {
  await requirePermissionOrRedirect("manageSetupData", "/kurallar");
  const { regionId } = await params;
  const region = await prisma.region.findUnique({
    where: { id: regionId },
    include: { dutyRule: true },
  });
  if (!region) notFound();

  const action = upsertDutyRuleAction.bind(null, regionId);

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">{region.name} Nöbet Kuralı</h1>
      <Card>
        <CardHeader>
          <CardTitle>Kural Bilgileri</CardTitle>
          <CardDescription>
            Hafta içi, hafta sonu ve tatil günleri için nöbet ağırlıkları.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <DutyRuleForm action={action} rule={region.dutyRule} />
        </CardContent>
      </Card>
    </div>
  );
}
