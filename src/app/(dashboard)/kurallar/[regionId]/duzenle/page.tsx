import { notFound } from "next/navigation";

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { prisma } from "@/lib/prisma";
import { requireOrganizationRoleOrRedirect } from "@/lib/auth/tenant";
import { DutyRuleForm } from "../../duty-rule-form";
import { upsertDutyRuleAction } from "../../actions";

export default async function KuralDuzenlePage({
  params,
}: {
  params: Promise<{ regionId: string }>;
}) {
  const user = await requireOrganizationRoleOrRedirect("manageSetupData", "/kurallar");
  const { regionId } = await params;
  const region = await prisma.region.findFirst({
    where: { id: regionId, organizationId: user.organizationId },
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
