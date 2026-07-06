import { z } from "zod";

export const unavailabilitySchema = z
  .object({
    pharmacyId: z.string().trim().min(1, "Eczane seçiniz."),
    startDate: z.string().trim().min(1, "Başlangıç tarihi zorunludur."),
    endDate: z.string().trim().min(1, "Bitiş tarihi zorunludur."),
    reason: z.string().trim().optional(),
  })
  .refine((data) => new Date(data.endDate) >= new Date(data.startDate), {
    message: "Bitiş tarihi başlangıç tarihinden önce olamaz.",
    path: ["endDate"],
  });

export type UnavailabilityInput = z.infer<typeof unavailabilitySchema>;
