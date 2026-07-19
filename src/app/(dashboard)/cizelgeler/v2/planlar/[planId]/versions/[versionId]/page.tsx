import { notFound } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { ListBanner } from "@/components/layout/list-banner";
import { DeleteButton } from "@/components/layout/delete-button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { prisma } from "@/lib/prisma";
import { requireOrganizationMember } from "@/lib/auth/tenant";
import { hasPermission } from "@/lib/auth/permissions";
import { checkPlanVersionActivationReadiness } from "@/lib/duty-rules-v2/configuration/validate-plan-version-completeness";
import { BUILTIN_DAY_TYPES, type BuiltinDayType } from "@/lib/duty-rules-v2/domain/loaded-plan";
import { DayTypeRulesForm } from "./day-type-rules-form";
import { PolicyForm } from "./policy-form";
import { ShiftDefinitionsForm } from "./shift-definitions-form";
import { SlotRequirementsForm } from "./slot-requirements-form";
import { RotationPoolsSection } from "./rotation-pools-section";
import { ActivationSection } from "./activation-section";
import { deletePlanVersionAction } from "../../../actions";

export const dynamic = "force-dynamic";

const DAY_TYPE_LABELS: Record<BuiltinDayType, string> = {
  WEEKDAY: "Hafta İçi",
  SATURDAY: "Cumartesi",
  SUNDAY: "Pazar",
  OFFICIAL_HOLIDAY: "Resmi Bayram",
  RELIGIOUS_HOLIDAY: "Dini Bayram",
  HOLIDAY_EVE: "Bayram Arifesi",
};

const STATUS_LABEL: Record<string, string> = {
  DRAFT: "Taslak",
  UNDER_REVIEW: "İncelemede",
  APPROVED: "Onaylandı",
  ACTIVE: "Etkin",
  RETIRED: "Emekli",
  ARCHIVED: "Arşivlendi",
};

export default async function PlanVersionEditorPage({
  params,
  searchParams,
}: {
  params: Promise<{ planId: string; versionId: string }>;
  searchParams: Promise<{ success?: string; error?: string }>;
}) {
  const { planId, versionId } = await params;
  const { success, error } = await searchParams;
  const user = await requireOrganizationMember();
  const canManage = hasPermission(user.role, "managePlanConfiguration");

  const version = await prisma.dutyPlanVersion.findFirst({
    where: { id: versionId, planId, plan: { organizationId: user.organizationId } },
    select: {
      id: true,
      status: true,
      versionNumber: true,
      validFrom: true,
      validTo: true,
      plan: { select: { id: true, name: true, regionId: true, region: { select: { name: true } } } },
      dayTypeRules: {
        select: { id: true, dayType: true, isServed: true, weight: true },
      },
      minDaysBetweenDuties: true,
      relaxMinIntervalWhenInsufficient: true,
      sameDaySecondAssignmentAllowed: true,
      holidayEveWeightSource: true,
      holidayOverlapResolutionMode: true,
      shiftDefinitions: {
        select: {
          id: true,
          name: true,
          startMinute: true,
          endMinute: true,
          spansMidnight: true,
          defaultWeight: true,
          sortOrder: true,
        },
        orderBy: { sortOrder: "asc" },
      },
    },
  });
  if (!version) {
    notFound();
  }

  const regionId = version.plan.regionId;
  const isDraft = version.status === "DRAFT";
  const editable = isDraft && canManage;

  const [slots, pools, activePharmacies, readiness] = await Promise.all([
    prisma.slotRequirement.findMany({
      where: { dayTypeRule: { planVersionId: versionId } },
      select: {
        id: true,
        name: true,
        dayTypeRuleId: true,
        shiftDefinitionId: true,
        rotationPoolId: true,
        requiredCount: true,
        sortOrder: true,
      },
      orderBy: { sortOrder: "asc" },
    }),
    prisma.rotationPool.findMany({
      where: { organizationId: user.organizationId, OR: [{ regionId }, { regionId: null }] },
      select: {
        id: true,
        name: true,
        strategy: true,
        memberships: {
          select: {
            id: true,
            pharmacyId: true,
            joinedAt: true,
            leftAt: true,
            pharmacy: { select: { name: true } },
          },
          orderBy: [{ pharmacyId: "asc" }, { joinedAt: "asc" }],
        },
      },
      orderBy: { name: "asc" },
    }),
    prisma.pharmacy.findMany({
      where: { regionId, isActive: true },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    checkPlanVersionActivationReadiness({
      organizationId: user.organizationId,
      regionId,
      versionId,
    }),
  ]);

  const dayTypeRulesById = new Map(version.dayTypeRules.map((r) => [r.id, r]));

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-semibold">
              {version.plan.name} — Sürüm {version.versionNumber}
            </h1>
            <Badge variant={version.status === "ACTIVE" ? "success" : version.status === "RETIRED" ? "secondary" : "outline"}>
              {STATUS_LABEL[version.status] ?? version.status}
            </Badge>
            <Badge variant="outline">
              {version.minDaysBetweenDuties === null ? "V1 Uyumluluk Modu" : "Yerel V2 Politikası"}
            </Badge>
          </div>
          <p className="text-muted-foreground text-sm">{version.plan.region.name}</p>
          {!isDraft && (
            <p className="text-muted-foreground mt-1 text-sm">
              Bu sürüm {STATUS_LABEL[version.status] ?? version.status} olduğu için düzenlenemez.
            </p>
          )}
        </div>
        {editable && (
          <DeleteButton
            action={deletePlanVersionAction.bind(null, versionId)}
            confirmMessage={`${version.plan.name} — Sürüm ${version.versionNumber} taslağını silmek istediğinize emin misiniz? Bu işlem geri alınamaz.`}
          />
        )}
      </div>

      <ListBanner success={success} error={error} />

      <Card>
        <CardHeader>
          <CardTitle>Gün Tipleri</CardTitle>
          <CardDescription>Bu gün tiplerinde nöbet tutulup tutulmayacağını belirleyin.</CardDescription>
        </CardHeader>
        <CardContent>
          {editable ? (
            <DayTypeRulesForm
              planId={planId}
              versionId={versionId}
              initialRules={version.dayTypeRules.map((r) => ({
                dayType: r.dayType as BuiltinDayType,
                isServed: r.isServed,
                weight: r.weight,
              }))}
            />
          ) : (
            <ul className="flex flex-col gap-1 text-sm">
              {BUILTIN_DAY_TYPES.map((dayType) => {
                const rule = version.dayTypeRules.find((r) => r.dayType === dayType);
                return (
                  <li key={dayType}>
                    {DAY_TYPE_LABELS[dayType]}: {rule?.isServed ? "Nöbet var" : "Nöbet yok"}
                    {rule?.weight !== null && rule?.weight !== undefined
                      ? ` (Ağırlık: ${rule.weight})`
                      : ""}
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Politika</CardTitle>
          <CardDescription>
            Bu sürümün kendi nöbet politikası — boş bırakılırsa V1 uyumluluk modu kullanılır.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {editable ? (
            <PolicyForm
              planId={planId}
              versionId={versionId}
              initialPolicy={{
                minDaysBetweenDuties: version.minDaysBetweenDuties,
                relaxMinIntervalWhenInsufficient: version.relaxMinIntervalWhenInsufficient,
                sameDaySecondAssignmentAllowed: version.sameDaySecondAssignmentAllowed,
                holidayEveWeightSource: version.holidayEveWeightSource,
                holidayOverlapResolutionMode: version.holidayOverlapResolutionMode,
              }}
            />
          ) : (
            <ul className="flex flex-col gap-1 text-sm">
              <li>
                Asgari Nöbet Aralığı:{" "}
                {version.minDaysBetweenDuties === null
                  ? "Yapılandırılmadı"
                  : `${version.minDaysBetweenDuties} gün`}
              </li>
              <li>
                Yetersiz eczane olduğunda asgari aralığı gevşet:{" "}
                {version.relaxMinIntervalWhenInsufficient ? "Evet" : "Hayır"}
              </li>
              <li>
                Aynı gün ikinci atamaya izin ver:{" "}
                {version.sameDaySecondAssignmentAllowed ? "Evet" : "Hayır"}
              </li>
              <li>
                Bayram Arifesi Ağırlık Kaynağı:{" "}
                {version.holidayEveWeightSource === "CONFIGURED"
                  ? "Yapılandırılmış değer"
                  : "Haftaiçi/haftasonu ağırlığı"}
              </li>
              <li>
                Bayram Çakışması Çözüm Modu:{" "}
                {version.holidayOverlapResolutionMode === "NATIVE_PRECEDENCE"
                  ? "Dini bayram önceliklidir"
                  : "Son girilen bayram kazanır (V1 uyumlu)"}
              </li>
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Vardiyalar</CardTitle>
        </CardHeader>
        <CardContent>
          {editable ? (
            <ShiftDefinitionsForm
              planId={planId}
              versionId={versionId}
              initialShifts={version.shiftDefinitions}
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Ad</TableHead>
                  <TableHead>Başlangıç</TableHead>
                  <TableHead>Bitiş</TableHead>
                  <TableHead>Ağırlık</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {version.shiftDefinitions.map((shift) => (
                  <TableRow key={shift.id}>
                    <TableCell>{shift.name}</TableCell>
                    <TableCell>{shift.startMinute}</TableCell>
                    <TableCell>{shift.endMinute}</TableCell>
                    <TableCell>{shift.defaultWeight}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Slot Gereksinimleri</CardTitle>
        </CardHeader>
        <CardContent>
          {editable ? (
            <SlotRequirementsForm
              planId={planId}
              versionId={versionId}
              initialSlots={slots}
              dayTypeRules={version.dayTypeRules.map((r) => ({ id: r.id, dayType: r.dayType as BuiltinDayType }))}
              shifts={version.shiftDefinitions.map((s) => ({ id: s.id, name: s.name }))}
              pools={pools.map((p) => ({ id: p.id, name: p.name }))}
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Gün Tipi</TableHead>
                  <TableHead>Vardiya</TableHead>
                  <TableHead>Havuz</TableHead>
                  <TableHead>Gereken Sayı</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {slots.map((slot) => {
                  const rule = dayTypeRulesById.get(slot.dayTypeRuleId);
                  const shift = version.shiftDefinitions.find((s) => s.id === slot.shiftDefinitionId);
                  const pool = pools.find((p) => p.id === slot.rotationPoolId);
                  return (
                    <TableRow key={slot.id}>
                      <TableCell>{rule ? DAY_TYPE_LABELS[rule.dayType as BuiltinDayType] : "—"}</TableCell>
                      <TableCell>{shift?.name ?? "—"}</TableCell>
                      <TableCell>{pool?.name ?? "Varsayılan"}</TableCell>
                      <TableCell>{slot.requiredCount}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Rotasyon Havuzları</CardTitle>
        </CardHeader>
        <CardContent>
          <RotationPoolsSection
            planId={planId}
            versionId={versionId}
            regionId={regionId}
            pools={pools.map((p) => ({
              id: p.id,
              name: p.name,
              strategy: p.strategy as import("@/lib/duty-rules-v2/domain/loaded-plan").RotationStrategyValue,
              memberships: p.memberships.map((m) => ({
                id: m.id,
                pharmacyId: m.pharmacyId,
                pharmacyName: m.pharmacy.name,
                joinedOn: m.joinedAt.toISOString().slice(0, 10),
                leftOn: m.leftAt ? m.leftAt.toISOString().slice(0, 10) : null,
              })),
            }))}
            activePharmacies={activePharmacies}
            editable={editable}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Etkinleştirme</CardTitle>
        </CardHeader>
        <CardContent>
          <ActivationSection
            planId={planId}
            versionId={versionId}
            regionId={regionId}
            isAdmin={user.role === "ADMIN"}
            isDraft={isDraft}
            blockingIssues={readiness.ok ? [] : readiness.blockingIssues}
            advisoryIssues={readiness.ok ? readiness.advisoryIssues : readiness.advisoryIssues}
          />
        </CardContent>
      </Card>
    </div>
  );
}
