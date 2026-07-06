import { z } from "zod";

export const editDutyAssignmentSchema = z.object({
  pharmacyId: z.string().trim().min(1, "Eczane seçiniz."),
  reason: z.string().trim().min(1, "Değişiklik nedeni zorunludur."),
});

export type EditDutyAssignmentInput = z.infer<typeof editDutyAssignmentSchema>;
