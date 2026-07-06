import { z } from "zod";

export const createDutyScheduleSchema = z.object({
  month: z.coerce
    .number({ invalid_type_error: "Ay seçiniz." })
    .int("Ay 1 ile 12 arasında olmalıdır.")
    .min(1, "Ay 1 ile 12 arasında olmalıdır.")
    .max(12, "Ay 1 ile 12 arasında olmalıdır."),
  year: z.coerce
    .number({ invalid_type_error: "Yıl seçiniz." })
    .int("Yıl 2025 ile 2035 arasında olmalıdır.")
    .min(2025, "Yıl 2025 ile 2035 arasında olmalıdır.")
    .max(2035, "Yıl 2025 ile 2035 arasında olmalıdır."),
  regionId: z.string().trim().min(1, "Nöbet bölgesi seçiniz."),
});

export type CreateDutyScheduleInput = z.infer<typeof createDutyScheduleSchema>;
