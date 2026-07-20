import { z } from "zod";

import { safeHttpUrlSchema } from "./safe-url";

export const pharmacySchema = z.object({
  name: z.string().trim().min(1, "Eczane adı zorunludur."),
  pharmacistName: z.string().trim().min(1, "Eczacı adı zorunludur."),
  phone: z
    .string()
    .trim()
    .min(1, "Telefon numarası zorunludur.")
    .regex(/^[0-9+()\s-]+$/, "Geçerli bir telefon numarası giriniz."),
  address: z.string().trim().min(1, "Adres zorunludur."),
  // Opsiyonel — dolu olduğunda nöbet hatırlatma e-postaları bu adrese
  // gönderilir (bkz. src/lib/reminders/send-duty-reminders.ts).
  email: z.union([z.literal(""), z.string().trim().email("Geçerli bir e-posta adresi giriniz.")]).optional(),
  city: z.string().trim().min(1, "İl zorunludur."),
  district: z.string().trim().min(1, "İlçe zorunludur."),
  regionId: z.string().trim().min(1, "Nöbet bölgesi seçiniz."),
  // Boş string = etiketsiz (opsiyonel) — createPharmacyAction/
  // updatePharmacyAction bunu null'a çevirir.
  serviceAreaId: z.union([z.literal(""), z.string().trim().min(1)]).optional(),
  mapUrl: z.union([z.literal(""), safeHttpUrlSchema()]).optional(),
  isActive: z.coerce.boolean().default(true),
});

export type PharmacyInput = z.infer<typeof pharmacySchema>;
