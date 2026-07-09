"use server";

import { z } from "zod";

import { prisma } from "@/lib/prisma";
import { zodErrorState, type ActionState } from "@/lib/action-state";

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

  // Çift gönderim koruması: aynı eczane için aynı talep türü, tarih
  // aralığı ve açıklamayla açık (PENDING/LATE) bir talep zaten varsa,
  // ikinci bir satır oluşturmak yerine mevcut talebi kabul edilmiş gibi
  // göster. Çift tıklama/form yeniden gönderimi/ağ tekrar denemesi için
  // yeterlidir; gerçek eşzamanlı çift gönderimde küçük bir yarış penceresi
  // kalır (bkz. docs/security/12-idempotency-retry-safety.md).
  const duplicateRequest = await prisma.dutyRequest.findFirst({
    where: {
      pharmacyId: pharmacy.id,
      requestType: parsed.data.requestType,
      startDate: parsed.data.startDate,
      endDate: parsed.data.endDate,
      explanation: parsed.data.explanation,
      source: "PUBLIC_LINK",
      status: { in: ["PENDING", "LATE"] },
    },
    select: { id: true },
  });
  if (duplicateRequest) {
    return {
      success: true,
      message: "Bu talep daha önce alınmış. Lütfen mevcut talebinizin incelenmesini bekleyin.",
    };
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
    },
  });

  return {
    success: true,
    message: "Talebiniz eczacı odası incelemesine gönderildi.",
  };
}
