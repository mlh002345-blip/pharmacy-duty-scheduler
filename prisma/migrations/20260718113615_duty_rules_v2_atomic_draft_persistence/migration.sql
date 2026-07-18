-- CreateEnum
CREATE TYPE "AssignmentOrigin" AS ENUM ('STRICT', 'RELAXED');

-- CreateEnum
CREATE TYPE "DutyGenerationRunStatus" AS ENUM ('COMMITTED');

-- AlterTable
ALTER TABLE "DutyAssignment" ADD COLUMN     "decisiveCriterion" TEXT,
ADD COLUMN     "draftAssignmentKey" TEXT,
ADD COLUMN     "fallbackUsed" BOOLEAN,
ADD COLUMN     "generationRunId" TEXT,
ADD COLUMN     "membershipId" TEXT,
ADD COLUMN     "origin" "AssignmentOrigin",
ADD COLUMN     "selectedRank" INTEGER,
ADD COLUMN     "selectionOrdinal" INTEGER,
ADD COLUMN     "strategyId" TEXT,
ADD COLUMN     "strategyType" TEXT;

-- CreateTable
CREATE TABLE "DutyGenerationRun" (
    "id" TEXT NOT NULL,
    "status" "DutyGenerationRunStatus" NOT NULL DEFAULT 'COMMITTED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "organizationId" TEXT NOT NULL,
    "regionId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "planVersionId" TEXT NOT NULL,
    "dutyScheduleId" TEXT NOT NULL,
    "generationMode" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "configurationFingerprint" TEXT NOT NULL,
    "runtimeInputHash" TEXT NOT NULL,
    "ruleSetFingerprint" TEXT NOT NULL,
    "strategySetFingerprint" TEXT NOT NULL,
    "upstreamResultFingerprint" TEXT NOT NULL,
    "membershipSnapshotHash" TEXT NOT NULL,
    "provisionalSelectionFingerprint" TEXT NOT NULL,
    "completeDraftFingerprint" TEXT NOT NULL,
    "engineVersion" INTEGER NOT NULL,
    "selectionEngineVersion" INTEGER NOT NULL,
    "draftEngineVersion" INTEGER NOT NULL,
    "manifest" JSONB NOT NULL,

    CONSTRAINT "DutyGenerationRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DutyGenerationRun_dutyScheduleId_key" ON "DutyGenerationRun"("dutyScheduleId");

-- CreateIndex
CREATE UNIQUE INDEX "DutyGenerationRun_completeDraftFingerprint_key" ON "DutyGenerationRun"("completeDraftFingerprint");

-- CreateIndex
CREATE INDEX "DutyGenerationRun_organizationId_regionId_idx" ON "DutyGenerationRun"("organizationId", "regionId");

-- CreateIndex
CREATE INDEX "DutyGenerationRun_planVersionId_idx" ON "DutyGenerationRun"("planVersionId");

-- CreateIndex
CREATE INDEX "DutyGenerationRun_dutyScheduleId_idx" ON "DutyGenerationRun"("dutyScheduleId");

-- CreateIndex
CREATE INDEX "DutyAssignment_generationRunId_idx" ON "DutyAssignment"("generationRunId");

-- CreateIndex
CREATE INDEX "DutyAssignment_membershipId_idx" ON "DutyAssignment"("membershipId");

-- CreateIndex
CREATE UNIQUE INDEX "DutyAssignment_generationRunId_draftAssignmentKey_key" ON "DutyAssignment"("generationRunId", "draftAssignmentKey");

-- CreateIndex
CREATE UNIQUE INDEX "DutyAssignment_generationRunId_slotKey_selectionOrdinal_key" ON "DutyAssignment"("generationRunId", "slotKey", "selectionOrdinal");

-- AddForeignKey
ALTER TABLE "DutyAssignment" ADD CONSTRAINT "DutyAssignment_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "RotationPoolMembership"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DutyAssignment" ADD CONSTRAINT "DutyAssignment_generationRunId_fkey" FOREIGN KEY ("generationRunId") REFERENCES "DutyGenerationRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DutyGenerationRun" ADD CONSTRAINT "DutyGenerationRun_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DutyGenerationRun" ADD CONSTRAINT "DutyGenerationRun_regionId_fkey" FOREIGN KEY ("regionId") REFERENCES "Region"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DutyGenerationRun" ADD CONSTRAINT "DutyGenerationRun_planId_fkey" FOREIGN KEY ("planId") REFERENCES "DutyPlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DutyGenerationRun" ADD CONSTRAINT "DutyGenerationRun_planVersionId_fkey" FOREIGN KEY ("planVersionId") REFERENCES "DutyPlanVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DutyGenerationRun" ADD CONSTRAINT "DutyGenerationRun_dutyScheduleId_fkey" FOREIGN KEY ("dutyScheduleId") REFERENCES "DutySchedule"("id") ON DELETE CASCADE ON UPDATE CASCADE;

