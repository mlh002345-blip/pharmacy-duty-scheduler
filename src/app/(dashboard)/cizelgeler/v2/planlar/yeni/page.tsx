import { prisma } from "@/lib/prisma";
import { requireOrganizationRoleOrRedirect } from "@/lib/auth/tenant";
import { PlanForm } from "./plan-form";

export const dynamic = "force-dynamic";

export default async function NewDutyPlanPage() {
  const user = await requireOrganizationRoleOrRedirect(
    "managePlanConfiguration",
    "/cizelgeler/v2/planlar"
  );

  const regions = await prisma.region.findMany({
    where: { organizationId: user.organizationId, isActive: true },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Yeni Plan Oluştur</h1>
        <p className="text-muted-foreground text-sm">
          Bir bölge için yeni bir V2 nöbet planı ve ilk taslak sürümünü oluşturun.
        </p>
      </div>
      <PlanForm regions={regions} />
    </div>
  );
}
