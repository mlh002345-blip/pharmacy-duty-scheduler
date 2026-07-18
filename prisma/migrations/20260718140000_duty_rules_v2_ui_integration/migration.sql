-- CreateEnum
CREATE TYPE "CompleteDraftStatus" AS ENUM ('COMPLETE', 'PARTIAL', 'INVALID');

-- CreateTable
CREATE TABLE "DutyDraftPreview" (
    "id" TEXT NOT NULL,
    "status" "CompleteDraftStatus" NOT NULL,
    "isCommitEligible" BOOLEAN NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "assignmentCount" INTEGER NOT NULL,
    "missingAssignmentCount" INTEGER NOT NULL,
    "warningCount" INTEGER NOT NULL,
    "completeDraftFingerprint" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "organizationId" TEXT NOT NULL,
    "regionId" TEXT NOT NULL,
    "planVersionId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,

    CONSTRAINT "DutyDraftPreview_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DutyDraftPreview_organizationId_regionId_idx" ON "DutyDraftPreview"("organizationId", "regionId");

-- CreateIndex
CREATE INDEX "DutyDraftPreview_expiresAt_idx" ON "DutyDraftPreview"("expiresAt");

-- AddForeignKey
ALTER TABLE "DutyDraftPreview" ADD CONSTRAINT "DutyDraftPreview_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DutyDraftPreview" ADD CONSTRAINT "DutyDraftPreview_regionId_fkey" FOREIGN KEY ("regionId") REFERENCES "Region"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DutyDraftPreview" ADD CONSTRAINT "DutyDraftPreview_planVersionId_fkey" FOREIGN KEY ("planVersionId") REFERENCES "DutyPlanVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DutyDraftPreview" ADD CONSTRAINT "DutyDraftPreview_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

