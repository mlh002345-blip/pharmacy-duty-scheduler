import { notFound } from "next/navigation";

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { prisma } from "@/lib/prisma";
import { getTurkishDayName } from "@/lib/scheduling/date-tr";
import { requireOrganizationRoleOrRedirect } from "@/lib/auth/tenant";
import { editDutyAssignmentAction } from "../../assignment-actions";
import { AssignmentEditForm } from "./assignment-edit-form";

export default async function AtamaDuzenlePage({
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
      pharmacy: { select: { name: true } },
      dutySchedule: { select: { regionId: true } },
    },
  });
  if (!assignment || assignment.dutyScheduleId !== scheduleId) notFound();

  const [candidatePharmacies, approvedBlockingRequests] = await Promise.all([
    prisma.pharmacy.findMany({
      where: { regionId: assignment.dutySchedule.regionId, isActive: true },
      select: { id: true, name: true, pharmacistName: true },
      orderBy: { name: "asc" },
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
  const candidatesWithAvailability = candidatePharmacies.map((pharmacy) => ({
    ...pharmacy,
    blocked: blockedPharmacyIds.has(pharmacy.id),
  }));

  const action = editDutyAssignmentAction.bind(null, assignmentId);

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">Nöbet Atamasını Düzenle</h1>
      <Card>
        <CardHeader>
          <CardTitle>
            {assignment.date.toLocaleDateString("tr-TR")} ({getTurkishDayName(assignment.date)})
          </CardTitle>
          <CardDescription>
            Mevcut nöbetçi eczane: {assignment.pharmacy.name}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <AssignmentEditForm
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
