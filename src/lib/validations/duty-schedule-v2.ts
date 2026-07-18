import { z } from "zod";

const isoDatePattern = /^\d{4}-\d{2}-\d{2}$/;

export const generateV2DraftSchema = z.object({
  regionId: z.string().trim().min(1, "Nöbet bölgesi seçiniz."),
  periodStart: z
    .string()
    .trim()
    .regex(isoDatePattern, "Geçerli bir başlangıç tarihi seçiniz."),
  periodEnd: z.string().trim().regex(isoDatePattern, "Geçerli bir bitiş tarihi seçiniz."),
});

export type GenerateV2DraftInput = z.infer<typeof generateV2DraftSchema>;
