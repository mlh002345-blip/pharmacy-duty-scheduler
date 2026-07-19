// Duty Rules V2 — Phase 13: manual assignment editing. Resolves the
// RotationPoolMembership row a manually-corrected V2 DutyAssignment must
// point at, so `pharmacyId` and `membershipId` never disagree about who
// filled a slot (see docs/architecture and the Phase 13 investigation
// notes for why a stale membershipId is otherwise an undetectable
// data-integrity corruption). This module lives OUTSIDE
// src/lib/duty-rules-v2/persistence/ (which is protected Phase 9 code)
// deliberately — it is a distinct, editing-time concern, not part of the
// generation/approval/publication pipeline.

import { prisma } from "@/lib/prisma";

export type ResolveReplacementMembershipParams = {
  organizationId: string;
  originalMembershipId: string; // the assignment's CURRENT membershipId, before edit
  candidatePharmacyId: string;
  asOfDate: Date; // the assignment's own date — membership must be open on this date
};

export type ResolveReplacementMembershipResult =
  | { ok: true; membershipId: string }
  | {
      ok: false;
      code:
        | "ORIGINAL_MEMBERSHIP_NOT_FOUND"
        | "CANDIDATE_NOT_POOL_MEMBER"
        | "CANDIDATE_MEMBERSHIP_NOT_OPEN_ON_DATE";
      message: string;
    };

export async function resolveReplacementMembership(
  params: ResolveReplacementMembershipParams
): Promise<ResolveReplacementMembershipResult> {
  const original = await prisma.rotationPoolMembership.findUnique({
    where: { id: params.originalMembershipId },
    select: { id: true, poolId: true, pool: { select: { organizationId: true } } },
  });

  // Defense in depth: the caller is expected to have already scoped the
  // assignment (and therefore this membership) to the acting user's
  // organization. This re-check never trusts that alone.
  if (!original || original.pool.organizationId !== params.organizationId) {
    return {
      ok: false,
      code: "ORIGINAL_MEMBERSHIP_NOT_FOUND",
      message: "Mevcut atamanın rotasyon üyeliği bulunamadı.",
    };
  }

  // "Active membership as of date D" = joinedAt <= D AND (leftAt IS NULL
  // OR leftAt > D), per prisma/schema.prisma's RotationPoolMembership
  // model comment — mirrored exactly here.
  const openMembership = await prisma.rotationPoolMembership.findFirst({
    where: {
      poolId: original.poolId,
      pharmacyId: params.candidatePharmacyId,
      joinedAt: { lte: params.asOfDate },
      OR: [{ leftAt: null }, { leftAt: { gt: params.asOfDate } }],
    },
    select: { id: true },
  });
  if (openMembership) {
    return { ok: true, membershipId: openMembership.id };
  }

  // Distinguish "never in this pool" from "in this pool, but not open on
  // this date" for a clearer Turkish error message.
  const anyMembership = await prisma.rotationPoolMembership.findFirst({
    where: { poolId: original.poolId, pharmacyId: params.candidatePharmacyId },
    select: { id: true },
  });
  if (anyMembership) {
    return {
      ok: false,
      code: "CANDIDATE_MEMBERSHIP_NOT_OPEN_ON_DATE",
      message:
        "Seçilen eczane bu rotasyon havuzunun üyesi, ancak bu tarihte üyeliği açık değil (henüz katılmamış veya ayrılmış).",
    };
  }

  return {
    ok: false,
    code: "CANDIDATE_NOT_POOL_MEMBER",
    message:
      "Seçilen eczane, bu atamanın ait olduğu rotasyon havuzunun üyesi değil.",
  };
}
