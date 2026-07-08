"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { requirePermissionOrState } from "@/lib/auth/guard";
import { writeAuditLog } from "@/lib/audit";
import { editDutyAssignmentSchema } from "@/lib/validations/duty-assignment";
import { zodErrorState } from "@/lib/action-state";
import {
  findMinDaysBetweenDutiesViolation,
  isAlreadyAssignedOnDate,
  isBlockedByApprovedDutyRequest,
  isEligibleReplacementPharmacy,
  isUnavailableOnDate,
} from "@/lib/scheduling/duty-assignment-edit";
import type { EditAssignmentActionState } from "./assignment-action-state";

export async function editDutyAssignmentAction(
  assignmentId: string,
  _prevState: EditAssignmentActionState,
  formData: FormData
): Promise<EditAssignmentActionState> {
  const guard = await requirePermissionOrState("editAssignment");
  if (!guard.user) return guard.state;
  const { user } = guard;

  const parsed = editDutyAssignmentSchema.safeParse({
    pharmacyId: formData.get("pharmacyId"),
    reason: formData.get("reason"),
  });
  if (!parsed.success) {
    return zodErrorState(parsed.error, "Lütfen formdaki hataları düzeltin.");
  }
  const { pharmacyId: candidatePharmacyId, reason } = parsed.data;
  const confirmOverride = formData.get("confirmOverride") === "true";

  const assignment = await prisma.dutyAssignment.findUnique({
    where: { id: assignmentId },
    include: {
      pharmacy: true,
      dutySchedule: {
        include: { region: { include: { dutyRule: true } }, assignments: true },
      },
    },
  });
  if (!assignment) {
    return { success: false, message: "Nöbet ataması bulunamadı." };
  }

  if (candidatePharmacyId === assignment.pharmacyId) {
    return {
      success: false,
      message: "Lütfen formdaki hataları düzeltin.",
      errors: { pharmacyId: ["Seçilen eczane zaten bu tarihte atanmış."] },
    };
  }

  const candidate = await prisma.pharmacy.findUnique({
    where: { id: candidatePharmacyId },
  });
  if (
    !candidate ||
    !isEligibleReplacementPharmacy(candidate, assignment.dutySchedule.regionId)
  ) {
    return {
      success: false,
      message: "Lütfen formdaki hataları düzeltin.",
      errors: { pharmacyId: ["Seçilen eczane bu bölgede aktif değil."] },
    };
  }

  if (
    isAlreadyAssignedOnDate({
      assignmentId: assignment.id,
      candidatePharmacyId,
      date: assignment.date,
      scheduleAssignments: assignment.dutySchedule.assignments,
    })
  ) {
    return {
      success: false,
      message: "Lütfen formdaki hataları düzeltin.",
      errors: { pharmacyId: ["Seçilen eczane bu tarihte zaten atanmış."] },
    };
  }

  const unavailabilities = await prisma.unavailability.findMany({
    where: { pharmacyId: candidatePharmacyId },
  });
  if (
    isUnavailableOnDate({
      candidatePharmacyId,
      date: assignment.date,
      unavailabilities,
    })
  ) {
    return {
      success: false,
      message: "Lütfen formdaki hataları düzeltin.",
      errors: { pharmacyId: ["Seçilen eczane bu tarihte mazeretli."] },
    };
  }

  const approvedBlockingRequests = await prisma.dutyRequest.findMany({
    where: {
      pharmacyId: candidatePharmacyId,
      status: "APPROVED",
      requestType: { in: ["CANNOT_DUTY", "EMERGENCY_EXCUSE"] },
    },
    select: { pharmacyId: true, requestType: true, startDate: true, endDate: true },
  });
  if (
    isBlockedByApprovedDutyRequest({
      candidatePharmacyId,
      date: assignment.date,
      dutyRequests: approvedBlockingRequests as {
        pharmacyId: string;
        requestType: "CANNOT_DUTY" | "EMERGENCY_EXCUSE";
        startDate: Date;
        endDate: Date;
      }[],
    })
  ) {
    return {
      success: false,
      message: "Lütfen formdaki hataları düzeltin.",
      errors: {
        pharmacyId: [
          "Bu eczanenin seçilen tarih için onaylı nöbet tutamama veya acil mazeret talebi bulunmaktadır. Manuel atama yapılamaz. Önce ilgili talebi iptal edin veya reddedin.",
        ],
      },
    };
  }

  const dutyRule = assignment.dutySchedule.region.dutyRule;
  if (dutyRule && !confirmOverride) {
    const otherAssignments = await prisma.dutyAssignment.findMany({
      where: { pharmacyId: candidatePharmacyId },
    });
    const violationGap = findMinDaysBetweenDutiesViolation({
      assignmentId: assignment.id,
      candidatePharmacyId,
      date: assignment.date,
      minDaysBetweenDuties: dutyRule.minDaysBetweenDuties,
      otherAssignments,
    });
    if (violationGap !== null) {
      return {
        success: false,
        message: "",
        requiresConfirmation: true,
        warning: `Bu eczanenin başka bir nöbeti bu tarihe ${violationGap} gün mesafede. Asgari nöbet aralığı kuralı (${dutyRule.minDaysBetweenDuties} gün) ihlal ediliyor. Yine de devam etmek istiyor musunuz?`,
      };
    }
  }

  const before = {
    pharmacyId: assignment.pharmacyId,
    pharmacyName: assignment.pharmacy.name,
    note: assignment.note,
    isManual: assignment.isManual,
  };

  try {
    await prisma.$transaction(async (tx) => {
      const updated = await tx.dutyAssignment.update({
        where: { id: assignment.id },
        data: { pharmacyId: candidatePharmacyId, isManual: true, note: reason },
      });

      const after = {
        pharmacyId: updated.pharmacyId,
        pharmacyName: candidate.name,
        note: updated.note,
        isManual: updated.isManual,
        reason,
      };

      await writeAuditLog(tx, {
        userId: user.id,
        action: "UPDATE",
        entity: "DutyAssignment",
        entityId: assignment.id,
        before,
        after,
        dutyAssignmentId: assignment.id,
      });
    });
  } catch (error) {
    // İki eşzamanlı düzenleme, her ikisi de güncellemeden önce yüklenen
    // bayat bir anlık görüntüye göre "bu eczane bu tarihte müsait"
    // sonucuna varabilir (isAlreadyAssignedOnDate kontrolü yukarıda).
    // Gerçek koruma, DutyAssignment(dutyScheduleId, pharmacyId, date)
    // üzerindeki veritabanı benzersizlik kısıtıdır; ikinci yazma buna
    // çarparsa P2002 fırlatır.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return {
        success: false,
        message: "Lütfen formdaki hataları düzeltin.",
        errors: {
          pharmacyId: ["Bu eczane aynı tarihte bu çizelgede zaten nöbetçi olarak atanmış."],
        },
      };
    }
    throw error;
  }

  revalidatePath(`/cizelgeler/${assignment.dutyScheduleId}`);
  redirect(
    `/cizelgeler/${assignment.dutyScheduleId}?success=${encodeURIComponent(
      "Nöbet ataması güncellendi."
    )}`
  );
}
