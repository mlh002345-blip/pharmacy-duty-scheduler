import Link from "next/link";
import { notFound } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { StatusToggleButton } from "@/components/layout/status-toggle-button";
import { ListBanner } from "@/components/layout/list-banner";
import { ROLE_LABELS } from "@/lib/auth/permissions";
import { prisma } from "@/lib/prisma";
import { BILLING_STATUS_LABELS, BILLING_STATUS_BADGE } from "@/lib/billing/labels";
import { setOrganizationStatusAction, updateOrganizationBillingAction } from "../actions";
import { OrganizationBillingForm } from "../organization-billing-form";
import { EmergencyResetButton } from "./emergency-reset-button";

export const dynamic = "force-dynamic";

export default async function KurumDetayPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ success?: string; error?: string }>;
}) {
  const { id } = await params;
  const { success, error } = await searchParams;

  const organization = await prisma.organization.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      province: true,
      slug: true,
      isActive: true,
      billingStatus: true,
      billingNotes: true,
      createdAt: true,
      updatedAt: true,
      _count: {
        select: { users: true, regions: true },
      },
    },
  });
  if (!organization) notFound();

  const [pharmacyCount, admins] = await Promise.all([
    prisma.pharmacy.count({ where: { region: { organizationId: id } } }),
    prisma.user.findMany({
      where: { organizationId: id, role: "ADMIN" },
      select: { id: true, name: true, email: true, isActive: true },
      orderBy: { name: "asc" },
    }),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">{organization.name}</h1>
          <p className="text-muted-foreground text-sm">{organization.province}</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" asChild>
            <Link href={`/platform/kurumlar/${organization.id}/duzenle`}>Düzenle</Link>
          </Button>
          <StatusToggleButton
            action={setOrganizationStatusAction.bind(null, organization.id, !organization.isActive)}
            isActive={organization.isActive}
          />
        </div>
      </div>

      <ListBanner success={success} error={error} />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader>
            <CardDescription>Durum</CardDescription>
            <CardTitle>
              <Badge variant={organization.isActive ? "success" : "secondary"}>
                {organization.isActive ? "Aktif" : "Pasif"}
              </Badge>
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>Kısa Ad (slug)</CardDescription>
            <CardTitle className="text-base">{organization.slug}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>Kullanıcı Sayısı</CardDescription>
            <CardTitle>{organization._count.users}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>Bölge / Eczane Sayısı</CardDescription>
            <CardTitle>
              {organization._count.regions} / {pharmacyCount}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>Faturalama</CardDescription>
            <CardTitle>
              <Badge variant={BILLING_STATUS_BADGE[organization.billingStatus]}>
                {BILLING_STATUS_LABELS[organization.billingStatus]}
              </Badge>
            </CardTitle>
          </CardHeader>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Faturalama Durumu</CardTitle>
          <CardDescription>
            Bu yalnızca bir durum kaydıdır — ödeme banka havalesi/fatura gibi sistem dışı bir
            kanaldan alınır. Ödeme alındığında veya gecikince durumu burada elle güncelleyin.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <OrganizationBillingForm
            action={updateOrganizationBillingAction.bind(null, organization.id)}
            billingStatus={organization.billingStatus}
            billingNotes={organization.billingNotes}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Yöneticiler</CardTitle>
          <CardDescription>
            Bu odaya ait ADMIN rolündeki kullanıcılar. Odanın kendi kendine şifre
            sıfırlaması çalışmıyorsa (ör. SMTP henüz kurulmadıysa), buradan bir acil durum
            sıfırlama bağlantısı üretip güvenli bir kanaldan iletebilirsiniz.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {admins.length === 0 ? (
            <p className="text-muted-foreground text-sm">Bu odaya ait bir yönetici bulunmuyor.</p>
          ) : (
            <ul className="flex flex-col gap-3">
              {admins.map((admin) => (
                <li key={admin.id} className="flex items-center justify-between gap-4 text-sm">
                  <span>
                    {admin.name}{" "}
                    <span className="text-muted-foreground">({admin.email})</span>
                  </span>
                  <div className="flex items-center gap-3">
                    <span className="text-muted-foreground text-xs">{ROLE_LABELS.ADMIN}</span>
                    <Badge variant={admin.isActive ? "success" : "secondary"}>
                      {admin.isActive ? "Aktif" : "Pasif"}
                    </Badge>
                    <EmergencyResetButton organizationId={organization.id} userId={admin.id} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
