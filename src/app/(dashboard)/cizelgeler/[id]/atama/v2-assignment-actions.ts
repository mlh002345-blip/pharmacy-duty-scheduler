"use server";

// Duty Rules V2 — Phase 13: manual assignment editing for V2-generated
// rows. This is a deliberate SIBLING of ./assignment-actions.ts (V1),
// not a modification of it — see the Phase 13 investigation notes for
// why the V1 action is unsafe to reuse unmodified for a row with
// generationRunId !== null (it never touches membershipId, which would
// then silently point at the WRONG pharmacy's rotation-pool-membership
// row after a plain pharmacyId swap).

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
import { resolveReplacementMembership } from "@/lib/duty-rules-v2/persistence-edit/resolve-replacement-membership";
import { resolveMinIntervalPolicy } from "@/lib/duty-rules-v2/persistence-edit/resolve-min-interval-policy";
import type { EditAssignmentActionState } from "./assignment-action-state";

export async function editV2DutyAssignmentAction(
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
  // through dutySchedule.region.organizationId, exactly as the V1 action
  // does. Never fetched globally and compared only in the UI.
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

  // Defensive — the page-level routing (Phase 13 constraints) already
  // sends V1 rows to the V1 edit route, but this action must never trust
  // routing alone.
  if (assignment.generationRunId === null) {
    return {
      success: false,
      message: "Bu atama V2 ile oluşturulmadı; V1 düzenleme ekranını kullanın.",
    };
  }
  // Integrity invariant (see validate-generation-run-integrity.ts): every
  // V2 row must always carry a non-null membershipId. If it's somehow
  // null here, the generation run is already corrupted independent of
  // this edit — surface that rather than silently proceeding.
  if (assignment.membershipId === null) {
    return {
      success: false,
      message:
        "Bu atamanın rotasyon üyeliği kaydı eksik (üretim kaydı bozuk). Lütfen sistem yöneticinizle iletişime geçin.",
    };
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

  // Resolve which pharmacy's RotationPoolMembership row the corrected
  // assignment must point at — never trust a client-supplied membership
  // id, the server always re-derives it from the chosen pharmacyId plus
  // the assignment's own pool.
  const replacementMembership = await resolveReplacementMembership({
    organizationId: user.organizationId,
    originalMembershipId: assignment.membershipId,
    candidatePharmacyId,
    asOfDate: assignment.date,
  });
  if (!replacementMembership.ok) {
    return {
      success: false,
      message: "Lütfen formdaki hataları düzeltin.",
      errors: { pharmacyId: [replacementMembership.message] },
    };
  }

  const intervalPolicy = await resolveMinIntervalPolicy({
    dutyScheduleId: assignment.dutyScheduleId,
    organizationId: user.organizationId,
  });
  if (intervalPolicy && !confirmOverride) {
    const otherAssignments = await prisma.dutyAssignment.findMany({
      where: { pharmacyId: candidatePharmacyId },
    });
    const violationGap = findMinDaysBetweenDutiesViolation({
      assignmentId: assignment.id,
      candidatePharmacyId,
      date: assignment.date,
      minDaysBetweenDuties: intervalPolicy.minDaysBetweenDuties,
      otherAssignments,
    });
    if (violationGap !== null) {
      return {
        success: false,
        message: "",
        requiresConfirmation: true,
        warning: `Bu eczanenin başka bir nöbeti bu tarihe ${violationGap} gün mesafede. Asgari nöbet aralığı kuralı (${intervalPolicy.minDaysBetweenDuties} gün) ihlal ediliyor. Yine de devam etmek istiyor musunuz?`,
      };
    }
  }

  const before = {
    pharmacyId: assignment.pharmacyId,
    pharmacyName: assignment.pharmacy.name,
    membershipId: assignment.membershipId,
    note: assignment.note,
    isManual: assignment.isManual,
  };

  try {
    await prisma.$transaction(async (tx) => {
      // Explicitly does NOT touch slotKey/draftAssignmentKey/
      // selectionOrdinal/origin/strategyId/strategyType/fallbackUsed/
      // decisiveCriterion/generationRunId — per Phase 13 investigation
      // finding #3, nulling (or otherwise disturbing) any of those would
      // make validateGenerationRunIntegrity's incompleteCount check flag
      // the ENTIRE generation run as corrupted the next time
      // approveGeneratedDraft/publishApprovedSchedule runs. They stay
      // exactly as originally generated (historically accurate: "which
      // slot, in which original generation, this row still fills"),
      // while pharmacyId/membershipId are updated together to reflect
      // "who currently fills it after correction."
      //
      // RotationState is NOT touched here either, and that is correct,
      // intentional behavior (see Phase 13 investigation finding #5):
      // RotationState only ever advances once, permanently, at publish
      // time (publish-approved-schedule.ts), and is never re-derived
      // from DutyAssignment rows afterward. A manual correction changes
      // who is listed as on duty; it does not rewrite whose "turn" the
      // rotation counted historically — exactly like V1, which has no
      // rotation-state concept at all. This also means editing is safe
      // at ANY schedule status (DRAFT/APPROVED/PUBLISHED).
      const updated = await tx.dutyAssignment.update({
        where: { id: assignment.id },
        data: {
          pharmacyId: candidatePharmacyId,
          membershipId: replacementMembership.membershipId,
          isManual: true,
          note: reason,
        },
      });

      const after = {
        pharmacyId: updated.pharmacyId,
        pharmacyName: candidate.name,
        membershipId: updated.membershipId,
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
    // Same defense-in-depth as the V1 action: two concurrent edits could
    // both pass isAlreadyAssignedOnDate against their own stale
    // snapshot, with the real guarantee being the DB-level unique
    // constraint, which throws P2002 on the second write.
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
