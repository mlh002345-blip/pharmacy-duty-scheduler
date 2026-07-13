-- CreateEnum
CREATE TYPE "PharmacyImportCandidateSource" AS ENUM ('BOLGE_COLUMN', 'ILCE_COLUMN', 'ADDRESS_SUGGESTION', 'MANUAL');

-- CreateEnum
CREATE TYPE "PharmacyImportCandidateStatus" AS ENUM ('MATCHED_EXISTING_ACTIVE', 'MATCHED_EXISTING_INACTIVE', 'NEW_REGION_CANDIDATE', 'ADDRESS_SUGGESTION', 'AMBIGUOUS', 'UNRESOLVED', 'EXCLUDED_BY_ADMIN');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "PharmacyImportRowStatus" ADD VALUE 'REGION_PENDING';
ALTER TYPE "PharmacyImportRowStatus" ADD VALUE 'EXCLUDED';

-- AlterTable
ALTER TABLE "PharmacyImportRow" ADD COLUMN     "address" TEXT,
ADD COLUMN     "candidateId" TEXT,
ADD COLUMN     "sourceDistrictText" TEXT,
ADD COLUMN     "sourceRegionText" TEXT;

-- CreateTable
CREATE TABLE "PharmacyImportRegionCandidate" (
    "id" TEXT NOT NULL,
    "sourceValue" TEXT NOT NULL,
    "normalizedSourceValue" TEXT NOT NULL,
    "sourceType" "PharmacyImportCandidateSource" NOT NULL,
    "status" "PharmacyImportCandidateStatus" NOT NULL,
    "proposedName" TEXT NOT NULL,
    "normalizedProposedName" TEXT NOT NULL,
    "proposedCity" TEXT NOT NULL,
    "proposedDistrict" TEXT NOT NULL,
    "proposedIsActive" BOOLEAN NOT NULL DEFAULT true,
    "approvedAt" TIMESTAMP(3),
    "reactivateOnImport" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "batchId" TEXT NOT NULL,
    "matchedRegionId" TEXT,

    CONSTRAINT "PharmacyImportRegionCandidate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PharmacyImportRegionCandidate_batchId_idx" ON "PharmacyImportRegionCandidate"("batchId");

-- CreateIndex
CREATE INDEX "PharmacyImportRegionCandidate_matchedRegionId_idx" ON "PharmacyImportRegionCandidate"("matchedRegionId");

-- CreateIndex
CREATE UNIQUE INDEX "PharmacyImportRegionCandidate_batchId_normalizedSourceValue_key" ON "PharmacyImportRegionCandidate"("batchId", "normalizedSourceValue");

-- CreateIndex
CREATE INDEX "PharmacyImportRow_candidateId_idx" ON "PharmacyImportRow"("candidateId");

-- AddForeignKey
ALTER TABLE "PharmacyImportRegionCandidate" ADD CONSTRAINT "PharmacyImportRegionCandidate_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "PharmacyImportBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PharmacyImportRegionCandidate" ADD CONSTRAINT "PharmacyImportRegionCandidate_matchedRegionId_fkey" FOREIGN KEY ("matchedRegionId") REFERENCES "Region"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PharmacyImportRow" ADD CONSTRAINT "PharmacyImportRow_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "PharmacyImportRegionCandidate"("id") ON DELETE SET NULL ON UPDATE CASCADE;
