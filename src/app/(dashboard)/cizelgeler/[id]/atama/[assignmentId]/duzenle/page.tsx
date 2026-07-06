import { notFound } from "next/navigation";

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { prisma } from "@/lib/prisma";
import { getTurkishDayName } from "@/lib/scheduling/date-tr";
import { requirePermissionOrRedirect } from "@/lib/auth/guard";
import { editDutyAssignmentAction } from "../../assignment-actions";
import { AssignmentEditForm } from "./assignment-edit-form";

export default async function AtamaDuzenlePage({
  params,
}: {
  params: Promise<{ id: string; assignmentId: string }>;
}) {
  const { id: scheduleId, assignmentId } = await params;
  await requirePermissionOrRedirect("editAssignment", `/cizelgeler/${scheduleId}`);

  const assignment = await prisma.dutyAssignment.findUnique({
    where: { id: assignmentId },
    include: { pharmacy: true, dutySchedule: { include: { region: true } } },
  });
  if (!assignment || assignment.dutyScheduleId !== scheduleId) notFound();

  const candidatePharmacies = await prisma.pharmacy.findMany({
    where: { regionId: assignment.dutySchedule.regionId, isActive: true },
    orderBy: { name: "asc" },
  });

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
            candidatePharmacies={candidatePharmacies}
          />
        </CardContent>
      </Card>
    </div>
  );
}
