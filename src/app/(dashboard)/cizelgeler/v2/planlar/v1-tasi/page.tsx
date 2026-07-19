import Link from "next/link";
import { ArrowRightLeft } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { EmptyState } from "@/components/layout/empty-state";
import { ListBanner } from "@/components/layout/list-banner";
import { ConfirmSubmitForm } from "@/components/layout/confirm-submit-form";
import { prisma } from "@/lib/prisma";
import { requireOrganizationRoleOrRedirect } from "@/lib/auth/tenant";
import { migrateV1RegionToV2Action } from "./actions";

export const dynamic = "force-dynamic";

export default async function MigrateV1RegionsPage({
  searchParams,
}: {
  searchParams: Promise<{ success?: string; error?: string }>;
}) {
  const { success, error } = await searchParams;
  const user = await requireOrganizationRoleOrRedirect(
    "managePlanConfiguration",
    "/cizelgeler/v2/planlar"
  );

  const eligibleRegions = await prisma.region.findMany({
    where: {
      organizationId: user.organizationId,
      isActive: true,
      dutyRule: { isNot: null },
      dutyPlans: { none: {} },
    },
    select: {
      id: true,
      name: true,
      district: true,
      dailyDutyCount: true,
      _count: { select: { pharmacies: { where: { isActive: true } } } },
    },
    orderBy: { name: "asc" },
  });

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">V1&apos;den V2&apos;ye Taşı</h1>
        <p className="text-muted-foreground text-sm">
          Hâlihazırda V1 nöbet kuralıyla çalışan bir bölgeyi, mevcut ağırlıklarını ve
          asgari nöbet aralığını birebir koruyarak tek tıkla bir V2 planına dönüştürün.
          Taşıma sonrasında bölge V2 taslak oluşturmaya hazır olur; V2&apos;nin gün
          tipine özel havuzlar, çoklu vardiya gibi ek yeteneklerini kullanmak isterseniz
          oluşturulan planı Plan Yapılandırma sayfasından elle özelleştirebilirsiniz.
        </p>
      </div>

      <ListBanner success={success} error={error} />

      {eligibleRegions.length === 0 ? (
        <Card>
          <CardContent>
            <EmptyState
              icon={ArrowRightLeft}
              title="Taşınacak bir bölge bulunamadı."
              description="Bir bölgenin burada listelenmesi için aktif olması, bir V1 nöbet kuralına sahip olması ve henüz bir V2 planı olmaması gerekir."
            />
          </CardContent>
        </Card>
      ) : (
        <div className="flex flex-col gap-4">
          {eligibleRegions.map((region) => (
            <Card key={region.id}>
              <CardHeader>
                <CardTitle>{region.name}</CardTitle>
                <CardDescription>
                  {region.district} · Günlük {region.dailyDutyCount} eczane ·{" "}
                  {region._count.pharmacies} aktif eczane
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ConfirmSubmitForm
                  action={migrateV1RegionToV2Action.bind(null, region.id)}
                  confirmMessage={`${region.name} bölgesi V2'ye taşınsın mı? Mevcut V1 kuralı ve nöbet çizelgeleri hiçbir şekilde değişmez.`}
                  pendingText="Taşınıyor..."
                >
                  V2&apos;ye Taşı
                </ConfirmSubmitForm>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Button variant="outline" asChild className="w-fit">
        <Link href="/cizelgeler/v2/planlar">Plan Yapılandırmaya Dön</Link>
      </Button>
    </div>
  );
}
