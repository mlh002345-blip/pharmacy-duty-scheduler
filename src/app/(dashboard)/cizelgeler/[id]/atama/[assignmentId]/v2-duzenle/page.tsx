import { notFound } from "next/navigation";

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { prisma } from "@/lib/prisma";
import { getTurkishDayName } from "@/lib/scheduling/date-tr";
import { requireOrganizationRoleOrRedirect } from "@/lib/auth/tenant";
import { editV2DutyAssignmentAction } from "../../v2-assignment-actions";
import { V2AssignmentEditForm } from "./v2-assignment-edit-form";

export default async function V2AtamaDuzenlePage({
  params,
}: {
  params: Promise<{ id: string; assignmentId: string }>;
}) {
  const { id: scheduleId, assignmentId } = await params;
  const user = await requireOrganizationRoleOrRedirect(
    "editAssignment",
    `/cizelgeler/${scheduleId}`
  );

  const assignment = await prisma.dutyAssignment.findFirst({
    where: {
      id: assignmentId,
      dutySchedule: { region: { organizationId: user.organizationId } },
    },
    select: {
      date: true,
      pharmacyId: true,
      dutyScheduleId: true,
      generationRunId: true,
      membershipId: true,
      pharmacy: { select: { name: true } },
      dutySchedule: { select: { regionId: true } },
      membership: { select: { poolId: true } },
    },
  });
  // V2-only page — a V1 row (generationRunId null) or a foreign/missing
  // assignment both 404 here, exactly like the V1 edit page 404s for an
  // out-of-schedule assignment.
  if (
    !assignment ||
    assignment.dutyScheduleId !== scheduleId ||
    assignment.generationRunId === null ||
    assignment.membershipId === null ||
    assignment.membership === null
  ) {
    notFound();
  }

  const poolId = assignment.membership.poolId;

  // V2 assignments are POOL-scoped, not region-scoped: candidates are
  // exactly the pharmacies with an OPEN membership in this assignment's
  // own rotation pool as of the assignment's date — a genuine,
  // deliberate behavioral difference from V1's "every active pharmacy in
  // the region" list.
  const [poolMemberships, approvedBlockingRequests] = await Promise.all([
    prisma.rotationPoolMembership.findMany({
      where: {
        poolId,
        joinedAt: { lte: assignment.date },
        OR: [{ leftAt: null }, { leftAt: { gt: assignment.date } }],
      },
      select: { pharmacyId: true, pharmacy: { select: { id: true, name: true, pharmacistName: true } } },
      orderBy: { pharmacy: { name: "asc" } },
    }),
    prisma.dutyRequest.findMany({
      where: {
        status: "APPROVED",
        requestType: { in: ["CANNOT_DUTY", "EMERGENCY_EXCUSE"] },
        startDate: { lte: assignment.date },
        endDate: { gte: assignment.date },
      },
      select: { pharmacyId: true },
    }),
  ]);
  const blockedPharmacyIds = new Set(approvedBlockingRequests.map((r) => r.pharmacyId));
  const candidatesWithAvailability = poolMemberships.map((membership) => ({
    id: membership.pharmacy.id,
    name: membership.pharmacy.name,
    pharmacistName: membership.pharmacy.pharmacistName,
    blocked: blockedPharmacyIds.has(membership.pharmacy.id),
  }));

  const action = editV2DutyAssignmentAction.bind(null, assignmentId);

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">Nöbet Atamasını Düzenle (V2)</h1>
      <Card>
        <CardHeader>
          <CardTitle>
            {assignment.date.toLocaleDateString("tr-TR")} ({getTurkishDayName(assignment.date)})
          </CardTitle>
          <CardDescription>
            Mevcut nöbetçi eczane: {assignment.pharmacy.name}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <p className="rounded-md border border-sky-200 bg-sky-50 p-3 text-sm text-sky-900">
            Bu atama V2 kural motoruyla oluşturuldu. Bu düzenleme yalnızca kimin
            nöbetçi olarak göründüğünü değiştirir; rotasyon sırası (RotationState)
            zaten ilerlemiş olduğundan bu değişiklikten geriye dönük olarak
            etkilenmez.
          </p>
          <V2AssignmentEditForm
            action={action}
            scheduleId={scheduleId}
            currentPharmacyId={assignment.pharmacyId}
            candidatePharmacies={candidatesWithAvailability}
          />
        </CardContent>
      </Card>
    </div>
  );
}
