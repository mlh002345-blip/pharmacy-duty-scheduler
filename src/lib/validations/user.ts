import { z } from "zod";

export const USER_ROLE_VALUES = ["ADMIN", "STAFF", "VIEWER"] as const;

export const createUserSchema = z
  .object({
    name: z.string().trim().min(1, "Ad soyad zorunludur."),
    email: z
      .string()
      .trim()
      .min(1, "E-posta zorunludur.")
      .email("Geçerli bir e-posta giriniz."),
    role: z.enum(USER_ROLE_VALUES, { message: "Rol seçiniz." }),
    password: z.string().min(8, "Şifre en az 8 karakter olmalıdır."),
    passwordConfirmation: z.string().min(1, "Şifre tekrarı zorunludur."),
    isActive: z.coerce.boolean().default(true),
  })
  .superRefine((data, ctx) => {
    if (data.password !== data.passwordConfirmation) {
      ctx.addIssue({
        code: "custom",
        message: "Şifreler eşleşmiyor.",
        path: ["passwordConfirmation"],
      });
    }
  });

export type CreateUserInput = z.infer<typeof createUserSchema>;

export const updateUserSchema = z
  .object({
    name: z.string().trim().min(1, "Ad soyad zorunludur."),
    email: z
      .string()
      .trim()
      .min(1, "E-posta zorunludur.")
      .email("Geçerli bir e-posta giriniz."),
    role: z.enum(USER_ROLE_VALUES, { message: "Rol seçiniz." }),
    isActive: z.coerce.boolean().default(true),
    password: z.string().optional(),
    passwordConfirmation: z.string().optional(),
  })
  .superRefine((data, ctx) => {
    const password = data.password?.trim() ?? "";
    if (!password) return;

    if (password.length < 8) {
      ctx.addIssue({
        code: "custom",
        message: "Şifre en az 8 karakter olmalıdır.",
        path: ["password"],
      });
    }
    if (password !== (data.passwordConfirmation ?? "")) {
      ctx.addIssue({
        code: "custom",
        message: "Şifreler eşleşmiyor.",
        path: ["passwordConfirmation"],
      });
    }
  });

export type UpdateUserInput = z.infer<typeof updateUserSchema>;
