import { z } from "zod";

export const holidaySchema = z.object({
  date: z.string().trim().min(1, "Tarih zorunludur."),
  name: z.string().trim().min(1, "Tatil adı zorunludur."),
  type: z.enum(["OFFICIAL", "RELIGIOUS", "OTHER"], {
    message: "Tatil türü seçiniz.",
  }),
});

export type HolidayInput = z.infer<typeof holidaySchema>;

export const HOLIDAY_TYPE_LABELS: Record<string, string> = {
  OFFICIAL: "Resmî Tatil",
  RELIGIOUS: "Dini Bayram",
  OTHER: "Diğer",
};
