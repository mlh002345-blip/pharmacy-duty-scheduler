import { z } from "zod";

export const loginSchema = z.object({
  email: z
    .string()
    .trim()
    .min(1, "E-posta zorunludur.")
    .email("Geçerli bir e-posta giriniz."),
  password: z.string().min(1, "Şifre zorunludur."),
});

export type LoginInput = z.infer<typeof loginSchema>;
