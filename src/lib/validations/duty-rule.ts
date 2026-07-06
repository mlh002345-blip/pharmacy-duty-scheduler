import { z } from "zod";

export const dutyRuleSchema = z.object({
  minDaysBetweenDuties: z.coerce
    .number({ invalid_type_error: "Sayı giriniz." })
    .int("Tam sayı giriniz.")
    .min(0, "En az 0 olmalıdır."),
  weekdayWeight: z.coerce
    .number({ invalid_type_error: "Sayı giriniz." })
    .positive("Pozitif bir sayı giriniz."),
  saturdayWeight: z.coerce
    .number({ invalid_type_error: "Sayı giriniz." })
    .positive("Pozitif bir sayı giriniz."),
  sundayWeight: z.coerce
    .number({ invalid_type_error: "Sayı giriniz." })
    .positive("Pozitif bir sayı giriniz."),
  officialHolidayWeight: z.coerce
    .number({ invalid_type_error: "Sayı giriniz." })
    .positive("Pozitif bir sayı giriniz."),
  religiousHolidayWeight: z.coerce
    .number({ invalid_type_error: "Sayı giriniz." })
    .positive("Pozitif bir sayı giriniz."),
});

export type DutyRuleInput = z.infer<typeof dutyRuleSchema>;
