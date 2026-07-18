// Duty Rules V2 — Phase 9: shared integrity re-check for a persisted
// DutyGenerationRun, used identically by both approve-generated-draft.ts
// and publish-approved-schedule.ts so the two services can never drift
// on what "corrupted" or "foreign-tenant" means. Read-only.

import { prisma } from "@/lib/prisma";

export type GenerationRunIntegrityFailure =
  | { code: "GENERATION_RECORD_CORRUPTED"; message: string }
  | { code: "TENANT_MISMATCH"; message: string };

type StoredManifestCounts = { counts?: { totalAssignments?: number } };

/** Re-verifies, against the CURRENT database state, everything Phase 8
 *  already guaranteed at commit time: fingerprint/manifest presence,
 *  persisted assignment count vs. the manifest's own count, complete
 *  per-assignment provenance, and that every referenced pharmacy/
 *  membership still belongs to the same tenant/region. Defense-in-depth
 *  against drift between commit time and approval/publication time —
 *  never trusts that "it was fine at commit time" is still true. */
export async function validateGenerationRunIntegrity(
  run: {
    id: string;
    organizationId: string;
    completeDraftFingerprint: string | null;
    manifest: unknown;
  },
  organizationId: string,
  regionId: string
): Promise<GenerationRunIntegrityFailure | null> {
  if (!run.completeDraftFingerprint || !run.manifest) {
    return { code: "GENERATION_RECORD_CORRUPTED", message: "Üretim kaydında fingerprint veya manifest eksik." };
  }

  const manifestCounts = (run.manifest as StoredManifestCounts).counts?.totalAssignments;
  const [assignmentCount, incompleteCount] = await Promise.all([
    prisma.dutyAssignment.count({ where: { generationRunId: run.id } }),
    prisma.dutyAssignment.count({
      where: {
        generationRunId: run.id,
        OR: [
          { draftAssignmentKey: null },
          { membershipId: null },
          { selectionOrdinal: null },
          { origin: null },
          { slotKey: null },
        ],
      },
    }),
  ]);
  if (typeof manifestCounts !== "number" || manifestCounts !== assignmentCount) {
    return {
      code: "GENERATION_RECORD_CORRUPTED",
      message: "Kalıcı atama sayısı, üretim manifestindeki sayı ile uyuşmuyor.",
    };
  }
  if (incompleteCount > 0) {
    return {
      code: "GENERATION_RECORD_CORRUPTED",
      message: "Bir veya daha fazla atamada eksik üretim izlenebilirliği var.",
    };
  }

  const assignments = await prisma.dutyAssignment.findMany({
    where: { generationRunId: run.id },
    select: { pharmacyId: true, membershipId: true },
  });
  const distinctPharmacyIds = [...new Set(assignments.map((a) => a.pharmacyId))];
  const distinctMembershipIds = [...new Set(assignments.map((a) => a.membershipId).filter((id): id is string => id !== null))];

  const [pharmacies, memberships] = await Promise.all([
    distinctPharmacyIds.length > 0
      ? prisma.pharmacy.findMany({ where: { id: { in: distinctPharmacyIds } }, select: { id: true, regionId: true } })
      : Promise.resolve([]),
    distinctMembershipIds.length > 0
      ? prisma.rotationPoolMembership.findMany({
          where: { id: { in: distinctMembershipIds } },
          select: { id: true, pool: { select: { organizationId: true, regionId: true } } },
        })
      : Promise.resolve([]),
  ]);

  if (pharmacies.length !== distinctPharmacyIds.length || pharmacies.some((p) => p.regionId !== regionId)) {
    return {
      code: "GENERATION_RECORD_CORRUPTED",
      message: "Bir eczane referansı geçersiz veya başka bir bölgeye ait.",
    };
  }
  if (
    memberships.length !== distinctMembershipIds.length ||
    memberships.some(
      (m) => m.pool.organizationId !== organizationId || (m.pool.regionId !== null && m.pool.regionId !== regionId)
    )
  ) {
    return {
      code: "GENERATION_RECORD_CORRUPTED",
      message: "Bir rotasyon üyeliği referansı geçersiz veya başka bir organizasyon/bölgeye ait.",
    };
  }

  return null;
}
