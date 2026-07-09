"use server";

import { z } from "zod";
import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { zodErrorState, type ActionState } from "@/lib/action-state";
import { computePublicRequestDedupKey } from "@/lib/duty-requests/dedup-key";

function isUniqueConstraintError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

const publicRequestSchema = z
  .object({
    requestType: z.enum(
      ["CANNOT_DUTY", "PREFER_DUTY", "SWAP_REQUEST", "EMERGENCY_EXCUSE"],
      { message: "Talep türü seçiniz." }
    ),
    startDate: z.coerce.date({ message: "Başlangıç tarihi geçersiz." }),
    endDate: z.coerce.date({ message: "Bitiş tarihi geçersiz." }),
    explanation: z.string().trim().min(10, "Açıklama en az 10 karakter olmalıdır."),
  })
  .refine((data) => data.endDate.getTime() >= data.startDate.getTime(), {
    message: "Bitiş tarihi başlangıç tarihinden önce olamaz.",
    path: ["endDate"],
  });

// Aynı eczane için aynı anda bekleyebilecek azami açık talep (basit koruma).
const MAX_OPEN_PUBLIC_REQUESTS = 10;

export async function createPublicDutyRequestAction(
  token: string,
  _state: ActionState,
  formData: FormData
): Promise<ActionState> {
  // Token doğrulaması: geçersiz token'da hiçbir bilgi sızdırma.
  const pharmacy = await prisma.pharmacy.findUnique({
    where: { requestToken: token },
    select: { id: true, name: true, regionId: true, isActive: true },
  });
  if (!pharmacy || !pharmacy.isActive) {
    return { success: false, message: "Bağlantı geçersiz veya artık kullanılamıyor." };
  }

  const parsed = publicRequestSchema.safeParse({
    requestType: formData.get("requestType"),
    startDate: formData.get("startDate"),
    endDate: formData.get("endDate"),
    explanation: formData.get("explanation"),
  });
  if (!parsed.success) {
    return zodErrorState(parsed.error, "Lütfen formdaki hataları düzeltin.");
  }

  const openCount = await prisma.dutyRequest.count({
    where: { pharmacyId: pharmacy.id, status: "PENDING", source: "PUBLIC_LINK" },
  });
  if (openCount >= MAX_OPEN_PUBLIC_REQUESTS) {
    return {
      success: false,
      message:
        "Bekleyen talep sayınız üst sınıra ulaştı. Lütfen eczacı odasının mevcut taleplerinizi incelemesini bekleyin.",
    };
  }

  // Çift gönderim koruması: dedupKey, DutyRequest üzerinde DB seviyesinde
  // @unique olduğu için, çift tıklama/form yeniden gönderimi/ağ tekrar
  // denemesi VE gerçek eşzamanlı çift gönderim eşit derecede güvenlidir —
  // ikinci create() bir P2002 ile başarısız olur.
  const dedupKey = computePublicRequestDedupKey({
    pharmacyId: pharmacy.id,
    requestType: parsed.data.requestType,
    startDate: parsed.data.startDate,
    endDate: parsed.data.endDate,
    explanation: parsed.data.explanation,
  });

  try {
    await prisma.dutyRequest.create({
      data: {
        pharmacyId: pharmacy.id,
        regionId: pharmacy.regionId,
        requestType: parsed.data.requestType,
        startDate: parsed.data.startDate,
        endDate: parsed.data.endDate,
        explanation: parsed.data.explanation,
        status: "PENDING",
        source: "PUBLIC_LINK",
        dedupKey,
      },
    });
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      return {
        success: true,
        message: "Bu talep daha önce alınmış. Lütfen mevcut talebinizin incelenmesini bekleyin.",
      };
    }
    throw error;
  }

  return {
    success: true,
    message: "Talebiniz eczacı odası incelemesine gönderildi.",
  };
}
