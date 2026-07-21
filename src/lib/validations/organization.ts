import { z } from "zod";

import { toAsciiSlug } from "@/lib/slug";

const CONTROL_CHAR_PATTERN = /[\x00-\x1f\x7f]/;

const organizationName = z
  .string()
  .trim()
  .min(1, "Oda adı zorunludur.")
  .max(120, "Oda adı en fazla 120 karakter olabilir.")
  .refine((value) => !CONTROL_CHAR_PATTERN.test(value), "Oda adı geçersiz karakter içeriyor.");

const organizationProvince = z
  .string()
  .trim()
  .min(1, "İl/bölge bilgisi zorunludur.")
  .max(80, "İl/bölge bilgisi en fazla 80 karakter olabilir.")
  .refine((value) => !CONTROL_CHAR_PATTERN.test(value), "İl/bölge bilgisi geçersiz karakter içeriyor.");

// Accepts either an operator-supplied slug or a blank field (the form
// falls back to slugifying the name); toAsciiSlug is applied by the
// caller after this schema passes, never inside it, so the same
// normalization always runs regardless of which path produced the raw
// value.
const organizationSlugInput = z
  .string()
  .trim()
  .max(60, "Kısa ad (slug) en fazla 60 karakter olabilir.")
  .refine((value) => !CONTROL_CHAR_PATTERN.test(value), "Kısa ad geçersiz karakter içeriyor.");

export const createOrganizationSchema = z.object({
  name: organizationName,
  province: organizationProvince,
  slug: organizationSlugInput,
  isActive: z.coerce.boolean().default(true),
  adminName: z.string().trim().min(1, "Yönetici adı soyadı zorunludur.").max(120),
  adminEmail: z
    .string()
    .trim()
    .min(1, "Yönetici e-postası zorunludur.")
    .email("Geçerli bir e-posta giriniz."),
  adminPassword: z.string().min(8, "Şifre en az 8 karakter olmalıdır."),
});

export type CreateOrganizationInput = z.infer<typeof createOrganizationSchema>;

// Kendi kendine kayıt (self-service) formu için — createOrganizationSchema
// ile aynı alanlar, artık halka açık bir formdan geldiği için şifre
// tekrarı zorunlu ve isActive alanı yok (her zaman true — bkz.
// src/app/kayit/actions.ts).
export const selfServiceSignupSchema = z
  .object({
    name: organizationName,
    province: organizationProvince,
    slug: organizationSlugInput,
    adminName: z.string().trim().min(1, "Yönetici adı soyadı zorunludur.").max(120),
    adminEmail: z
      .string()
      .trim()
      .min(1, "Yönetici e-postası zorunludur.")
      .email("Geçerli bir e-posta giriniz."),
    adminPassword: z.string().min(8, "Şifre en az 8 karakter olmalıdır."),
    adminPasswordConfirmation: z.string().min(1, "Şifre tekrarı zorunludur."),
    termsAccepted: z.coerce.boolean(),
  })
  .superRefine((data, ctx) => {
    if (data.adminPassword !== data.adminPasswordConfirmation) {
      ctx.addIssue({
        code: "custom",
        message: "Şifreler eşleşmiyor.",
        path: ["adminPasswordConfirmation"],
      });
    }
    if (!data.termsAccepted) {
      ctx.addIssue({
        code: "custom",
        message: "Devam etmek için KVKK Aydınlatma Metni ve Kullanım Şartları'nı kabul etmelisiniz.",
        path: ["termsAccepted"],
      });
    }
  });

export type SelfServiceSignupInput = z.infer<typeof selfServiceSignupSchema>;

export const updateOrganizationSchema = z.object({
  name: organizationName,
  province: organizationProvince,
  slug: organizationSlugInput,
});

export type UpdateOrganizationInput = z.infer<typeof updateOrganizationSchema>;

// Faturalama/ödeme DURUMU takibi — bkz. prisma/schema.prisma BillingStatus
// enum yorumu. Bu bir ödeme işleme akışı değildir; platform yöneticisi
// banka havalesi/fatura gibi sistem dışı bir kanaldan gelen ödemeyi burada
// yalnızca elle işaretler. Literaller Prisma'nın BillingStatus enum'u ve
// src/lib/billing/labels.ts içindeki BILLING_STATUS_OPTIONS ile senkron
// tutulmalıdır (z.enum bir literal tuple gerektirdiği için BillingStatus[]
// tipli bir sabit doğrudan kullanılamıyor).
export const updateOrganizationBillingSchema = z.object({
  billingStatus: z.enum(["TRIAL", "ACTIVE", "PAST_DUE", "CANCELED"], {
    message: "Geçerli bir faturalama durumu seçiniz.",
  }),
  billingNotes: z.preprocess(
    (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
    z
      .string()
      .trim()
      .max(500, "Faturalama notu en fazla 500 karakter olabilir.")
      .refine((value) => !CONTROL_CHAR_PATTERN.test(value), "Faturalama notu geçersiz karakter içeriyor.")
      .optional()
  ),
});

export type UpdateOrganizationBillingInput = z.infer<typeof updateOrganizationBillingSchema>;

// Normalizes a slug field the same way everywhere it's produced: an
// operator-supplied slug is transliterated/normalized exactly like a
// name-derived default would be, so "Örnek Slug!!" and "" (falling back
// to the name) always converge on the same shape.
export function normalizeOrganizationSlug(rawSlug: string, name: string): string {
  const source = rawSlug.length > 0 ? rawSlug : name;
  return toAsciiSlug(source);
}
