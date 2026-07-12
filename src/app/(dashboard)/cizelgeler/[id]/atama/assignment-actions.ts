"use server";

import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { requireOrganizationRole } from "@/lib/auth/tenant";
import { writeAuditLog } from "@/lib/audit";
import { redirectWithMessage } from "@/lib/flash-redirect";
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
  const guard = await requireOrganizationRole("editAssignment");
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

  // DutyAssignment has no direct organizationId — ownership is derived
  // through dutySchedule.region.organizationId. Verified here, before
  // any mutating call, never fetched globally and compared only in the
  // UI — a cross-organization assignmentId gets the same "not found" as
  // a truly-missing one.
  const assignment = await prisma.dutyAssignment.findFirst({
    where: { id: assignmentId, dutySchedule: { region: { organizationId: user.organizationId } } },
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

  // Cross-tenant relation validation: candidatePharmacyId is
  // client-supplied — only trusted after confirming it belongs to the
  // same organization as the assignment being edited.
  const candidate = await prisma.pharmacy.findFirst({
    where: { id: candidatePharmacyId, region: { organizationId: user.organizationId } },
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
        organizationId: user.organizationId,
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
  redirectWithMessage(
    `/cizelgeler/${assignment.dutyScheduleId}`,
    "success",
    "Nöbet ataması güncellendi."
  );
}
