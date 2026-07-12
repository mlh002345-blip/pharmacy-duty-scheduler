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

export const updateOrganizationSchema = z.object({
  name: organizationName,
  province: organizationProvince,
  slug: organizationSlugInput,
});

export type UpdateOrganizationInput = z.infer<typeof updateOrganizationSchema>;

// Normalizes a slug field the same way everywhere it's produced: an
// operator-supplied slug is transliterated/normalized exactly like a
// name-derived default would be, so "Örnek Slug!!" and "" (falling back
// to the name) always converge on the same shape.
export function normalizeOrganizationSlug(rawSlug: string, name: string): string {
  const source = rawSlug.length > 0 ? rawSlug : name;
  return toAsciiSlug(source);
}
