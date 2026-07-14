// Server-side service: re-derives every PharmacyImportRow status from
// the CURRENT candidate decisions and persists the result (row statuses,
// resolved regionIds, batch counters). Called after every candidate
// mutation and re-run inside the final import transaction — persisted
// statuses are never trusted at import time.

import type { Prisma, PrismaClient } from "@prisma/client";

import {
  recomputePharmacyImportRows,
  type PharmacyImportRowStatus,
  type PharmacyRowErrorCode,
  type RecomputeResult,
} from "./analyze-import";
import type { RegionCandidateStatus } from "./region-discovery";

type Db = PrismaClient | Prisma.TransactionClient;

export async function recomputeAndPersistBatch(
  db: Db,
  batchId: string,
  organizationId: string
): Promise<RecomputeResult> {
  const [rows, candidates, existingPharmacies] = await Promise.all([
    db.pharmacyImportRow.findMany({
      where: { batchId },
      select: {
        id: true,
        rowNumber: true,
        normalizedPharmacyName: true,
        status: true,
        safeErrorCode: true,
        candidateId: true,
        regionId: true,
      },
    }),
    db.pharmacyImportRegionCandidate.findMany({
      where: { batchId },
      select: {
        id: true,
        status: true,
        approvedAt: true,
        matchedRegionId: true,
        normalizedProposedName: true,
      },
    }),
    db.pharmacy.findMany({
      where: { region: { organizationId } },
      select: { regionId: true, normalizedName: true },
    }),
  ]);

  const result = recomputePharmacyImportRows(
    rows.map((row) => ({
      ...row,
      status: row.status as PharmacyImportRowStatus,
    })),
    candidates.map((candidate) => ({
      ...candidate,
      status: candidate.status as RegionCandidateStatus,
    })),
    existingPharmacies
  );

  // Persist only actual changes — candidate edits typically move a
  // handful of rows.
  const currentById = new Map(rows.map((row) => [row.id, row]));
  for (const updated of result.rows) {
    const current = currentById.get(updated.id);
    if (
      current &&
      (current.status !== updated.status ||
        current.safeErrorCode !== (updated.errorCode ?? null) ||
        current.regionId !== updated.regionId)
    ) {
      await db.pharmacyImportRow.update({
        where: { id: updated.id },
        data: {
          status: updated.status,
          safeErrorCode: updated.errorCode,
          regionId: updated.regionId,
        },
      });
    }
  }

  await db.pharmacyImportBatch.update({
    where: { id: batchId },
    data: {
      readyRows: result.readyCount,
      invalidRows: result.blockedCount,
    },
  });

  return result;
}

export type { RecomputeResult, PharmacyRowErrorCode };
