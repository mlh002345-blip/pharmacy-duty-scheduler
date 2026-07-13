import { z } from "zod";

const CONTROL_CHAR_PATTERN = /[\x00-\x1f\x7f]/;

const nameLike = (label: string) =>
  z
    .string()
    .trim()
    .min(1, `${label} zorunludur.`)
    .max(200, `${label} en fazla 200 karakter olabilir.`)
    .refine((value) => !CONTROL_CHAR_PATTERN.test(value), {
      message: `${label} geçersiz karakter içeriyor.`,
    })
    .transform((value) => value.replace(/\s+/g, " "));

// Fields the ADMIN can edit on a region candidate during import preview
// (and the fields of a manually defined preview candidate). Ownership is
// never part of this shape — organizationId always derives from the
// authenticated session through the parent batch.
export const regionCandidateEditSchema = z.object({
  proposedName: nameLike("Bölge adı"),
  proposedCity: nameLike("İl"),
  proposedDistrict: nameLike("İlçe"),
  proposedIsActive: z.coerce.boolean().default(true),
});

export type RegionCandidateEditInput = z.infer<typeof regionCandidateEditSchema>;
