import { z } from "zod";

export const regionSchema = z.object({
  name: z.string().trim().min(1, "Bölge adı zorunludur."),
  district: z.string().trim().min(1, "İlçe zorunludur."),
  dailyDutyCount: z.coerce
    .number({ invalid_type_error: "Sayı giriniz." })
    .int("Tam sayı giriniz.")
    .min(1, "Günlük nöbetçi sayısı en az 1 olmalıdır."),
  isActive: z.coerce.boolean().default(true),
});

export type RegionInput = z.infer<typeof regionSchema>;
