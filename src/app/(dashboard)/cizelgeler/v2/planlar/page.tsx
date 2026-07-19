import Link from "next/link";
import { Settings2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/layout/empty-state";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { ListBanner } from "@/components/layout/list-banner";
import { DeleteButton } from "@/components/layout/delete-button";
import { prisma } from "@/lib/prisma";
import { requireOrganizationMember } from "@/lib/auth/tenant";
import { hasPermission } from "@/lib/auth/permissions";
import { deletePlanVersionAction } from "./actions";

export const dynamic = "force-dynamic";

const STATUS_BADGE_VARIANT: Record<string, "outline" | "success" | "secondary"> = {
  DRAFT: "outline",
  UNDER_REVIEW: "outline",
  APPROVED: "outline",
  ACTIVE: "success",
  RETIRED: "secondary",
  ARCHIVED: "outline",
};

const STATUS_LABEL: Record<string, string> = {
  DRAFT: "Taslak",
  UNDER_REVIEW: "İncelemede",
  APPROVED: "Onaylandı",
  ACTIVE: "Etkin",
  RETIRED: "Emekli",
  ARCHIVED: "Arşivlendi",
};

export default async function DutyPlanConfigurationListPage({
  searchParams,
}: {
  searchParams: Promise<{ success?: string; error?: string; regionId?: string }>;
}) {
  const { success, error, regionId: regionIdParam } = await searchParams;
  const user = await requireOrganizationMember();
  const canManage = hasPermission(user.role, "managePlanConfiguration");

  const [regions, plans] = await Promise.all([
    prisma.region.findMany({
      where: { organizationId: user.organizationId },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    prisma.dutyPlan.findMany({
      where: {
        organizationId: user.organizationId,
        ...(regionIdParam ? { regionId: regionIdParam } : {}),
      },
      select: {
        id: true,
        name: true,
        region: { select: { id: true, name: true } },
        versions: {
          select: { id: true, versionNumber: true, status: true, validFrom: true, validTo: true },
          orderBy: { versionNumber: "desc" },
        },
      },
      orderBy: { name: "asc" },
    }),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">V2 Plan Yapılandırma</h1>
          <p className="text-muted-foreground text-sm">
            Bölgelerin gün tipi, vardiya, slot ve rotasyon havuzu yapılandırması.
          </p>
        </div>
        {canManage && (
          <div className="flex gap-2">
            <Button variant="outline" asChild>
              <Link href="/cizelgeler/v2/planlar/v1-tasi">V1&apos;den Taşı</Link>
            </Button>
            <Button asChild>
              <Link href="/cizelgeler/v2/planlar/yeni">Yeni Plan Oluştur</Link>
            </Button>
          </div>
        )}
      </div>

      <ListBanner success={success} error={error} />

      <form method="GET" className="flex flex-wrap items-end gap-3 rounded-xl border bg-white p-4 shadow-sm">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="regionId" className="text-muted-foreground text-xs">
            Bölge
          </label>
          <select
            id="regionId"
            name="regionId"
            defaultValue={regionIdParam ?? ""}
            className="border-input h-9 rounded-md border bg-transparent px-2 text-sm"
          >
            <option value="">Tümü</option>
            {regions.map((region) => (
              <option key={region.id} value={region.id}>
                {region.name}
              </option>
            ))}
          </select>
        </div>
        <Button type="submit" size="sm" variant="outline">
          Filtrele
        </Button>
      </form>

      {plans.length === 0 ? (
        <Card>
          <CardContent>
            <EmptyState
              icon={Settings2}
              title="Henüz bir V2 planı oluşturulmamış."
              description="Bir bölge için nöbet planı yapılandırması oluşturmak için başlayın."
              action={
                canManage ? (
                  <Button asChild size="sm">
                    <Link href="/cizelgeler/v2/planlar/yeni">Yeni Plan Oluştur</Link>
                  </Button>
                ) : undefined
              }
            />
          </CardContent>
        </Card>
      ) : (
        <div className="flex flex-col gap-4">
          {plans.map((plan) => (
            <Card key={plan.id}>
              <CardHeader>
                <CardTitle>{plan.name}</CardTitle>
                <CardDescription>{plan.region.name}</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex flex-col gap-2">
                  {plan.versions.map((version) => (
                    <div
                      key={version.id}
                      className="flex items-center justify-between gap-4 rounded-md border px-3 py-2"
                    >
                      <div className="flex items-center gap-3">
                        <span className="text-sm font-medium">Sürüm {version.versionNumber}</span>
                        <Badge variant={STATUS_BADGE_VARIANT[version.status] ?? "outline"}>
                          {STATUS_LABEL[version.status] ?? version.status}
                        </Badge>
                        <span className="text-muted-foreground text-xs">
                          {version.validFrom.toLocaleDateString("tr-TR")}
                          {version.validTo ? ` – ${version.validTo.toLocaleDateString("tr-TR")}` : ""}
                        </span>
                      </div>
                      <div className="flex gap-2">
                        <Button variant="outline" size="sm" asChild>
                          <Link href={`/cizelgeler/v2/planlar/${plan.id}/versions/${version.id}`}>
                            {version.status === "DRAFT" ? "Düzenle" : "Görüntüle"}
                          </Link>
                        </Button>
                        {version.status === "DRAFT" && canManage && (
                          <DeleteButton
                            action={deletePlanVersionAction.bind(null, version.id)}
                            confirmMessage={`${plan.name} — Sürüm ${version.versionNumber} taslağını silmek istediğinize emin misiniz? Bu işlem geri alınamaz.`}
                          />
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
