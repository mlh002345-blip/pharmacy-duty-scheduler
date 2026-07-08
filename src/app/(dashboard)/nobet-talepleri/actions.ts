"use server";

import { z } from "zod";

import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit";
import { redirectWithMessage } from "@/lib/flash-redirect";
import { requirePermissionOrState } from "@/lib/auth/guard";
import { zodErrorState, type ActionState } from "@/lib/action-state";
import { DUTY_REQUEST_TYPE_LABELS } from "@/lib/duty-requests/labels";

const createRequestSchema = z
  .object({
    pharmacyId: z.string().min(1, "Eczane seçimi zorunludur."),
    requestType: z.enum(
      ["CANNOT_DUTY", "PREFER_DUTY", "SWAP_REQUEST", "EMERGENCY_EXCUSE"],
      { message: "Talep türü seçiniz." }
    ),
    startDate: z.coerce.date({ message: "Başlangıç tarihi geçersiz." }),
    endDate: z.coerce.date({ message: "Bitiş tarihi geçersiz." }),
    explanation: z.string().trim().min(5, "Açıklama en az 5 karakter olmalıdır."),
    approveNow: z.literal("true").optional(),
  })
  .refine((data) => data.endDate.getTime() >= data.startDate.getTime(), {
    message: "Bitiş tarihi başlangıç tarihinden önce olamaz.",
    path: ["endDate"],
  });

export async function createDutyRequestAction(
  _state: ActionState,
  formData: FormData
): Promise<ActionState> {
  const guard = await requirePermissionOrState("manageSetupData");
  if (!guard.user) return { success: false, message: guard.state.message };

  const parsed = createRequestSchema.safeParse({
    pharmacyId: formData.get("pharmacyId"),
    requestType: formData.get("requestType"),
    startDate: formData.get("startDate"),
    endDate: formData.get("endDate"),
    explanation: formData.get("explanation"),
    approveNow: formData.get("approveNow") ?? undefined,
  });
  if (!parsed.success) {
    return zodErrorState(parsed.error, "Lütfen formdaki hataları düzeltin.");
  }

  const pharmacy = await prisma.pharmacy.findUnique({
    where: { id: parsed.data.pharmacyId },
    select: { id: true, name: true, regionId: true },
  });
  if (!pharmacy) {
    return { success: false, message: "Seçilen eczane bulunamadı." };
  }

  const approveNow = parsed.data.approveNow === "true";

  await prisma.$transaction(async (tx) => {
    const request = await tx.dutyRequest.create({
      data: {
        pharmacyId: pharmacy.id,
        regionId: pharmacy.regionId,
        requestType: parsed.data.requestType,
        startDate: parsed.data.startDate,
        endDate: parsed.data.endDate,
        explanation: parsed.data.explanation,
        source: "ADMIN_ENTRY",
        status: approveNow ? "APPROVED" : "PENDING",
        ...(approveNow
          ? { reviewedById: guard.user.id, reviewedAt: new Date(), reviewNote: "Oda girişinde doğrudan onaylandı." }
          : {}),
      },
    });
    await writeAuditLog(tx, {
      userId: guard.user.id,
      action: "CREATE",
      entity: "DutyRequest",
      entityId: request.id,
      after: {
        pharmacyName: pharmacy.name,
        requestType: DUTY_REQUEST_TYPE_LABELS[parsed.data.requestType],
        startDate: parsed.data.startDate.toISOString().slice(0, 10),
        endDate: parsed.data.endDate.toISOString().slice(0, 10),
        status: approveNow ? "APPROVED" : "PENDING",
      },
    });
  });

  redirectWithMessage(
    "/nobet-talepleri",
    "success",
    approveNow
      ? `${pharmacy.name} için talep oluşturuldu ve onaylandı.`
      : `${pharmacy.name} için talep oluşturuldu; incelemeyi bekliyor.`
  );
}

const reviewSchema = z.object({
  decision: z.enum(["APPROVED", "REJECTED", "CANCELLED"]),
  reviewNote: z.string().trim().optional(),
});

export async function reviewDutyRequestAction(
  requestId: string,
  _state: ActionState,
  formData: FormData
): Promise<ActionState> {
  const guard = await requirePermissionOrState("manageSetupData");
  if (!guard.user) return { success: false, message: guard.state.message };

  const parsed = reviewSchema.safeParse({
    decision: formData.get("decision"),
    reviewNote: formData.get("reviewNote") ?? undefined,
  });
  if (!parsed.success) {
    return { success: false, message: "Geçersiz inceleme işlemi." };
  }

  const { decision, reviewNote } = parsed.data;
  if (decision === "REJECTED" && (!reviewNote || reviewNote.length < 5)) {
    return {
      success: false,
      message: "Reddetme işlemi için en az 5 karakterlik bir inceleme notu zorunludur.",
      errors: { reviewNote: ["Reddetme için inceleme notu zorunludur."] },
    };
  }

  const request = await prisma.dutyRequest.findUnique({
    where: { id: requestId },
    select: {
      id: true,
      status: true,
      requestType: true,
      pharmacy: { select: { name: true } },
    },
  });
  if (!request) {
    return { success: false, message: "Talep bulunamadı." };
  }
  if (request.status !== "PENDING" && request.status !== "LATE") {
    return {
      success: false,
      message: "Yalnızca beklemede olan talepler incelenebilir.",
    };
  }

  await prisma.$transaction(async (tx) => {
    await tx.dutyRequest.update({
      where: { id: requestId },
      data: {
        status: decision,
        reviewedById: guard.user.id,
        reviewedAt: new Date(),
        reviewNote: reviewNote || null,
      },
    });
    await writeAuditLog(tx, {
      userId: guard.user.id,
      action: "UPDATE",
      entity: "DutyRequest",
      entityId: requestId,
      before: { status: request.status },
      after: {
        pharmacyName: request.pharmacy.name,
        requestType: DUTY_REQUEST_TYPE_LABELS[request.requestType],
        status: decision,
        reviewNote: reviewNote || null,
      },
    });
  });

  const decisionLabel =
    decision === "APPROVED"
      ? "onaylandı"
      : decision === "REJECTED"
        ? "reddedildi"
        : "iptal edildi";

  redirectWithMessage(
    "/nobet-talepleri",
    "success",
    `${request.pharmacy.name} eczanesinin talebi ${decisionLabel}.`
  );
}
