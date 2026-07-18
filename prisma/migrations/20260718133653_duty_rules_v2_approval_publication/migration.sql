-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "DutyGenerationRunStatus" ADD VALUE 'APPROVED';
ALTER TYPE "DutyGenerationRunStatus" ADD VALUE 'PUBLISHED';

-- AlterEnum
ALTER TYPE "DutyScheduleStatus" ADD VALUE 'APPROVED';

-- AlterTable
ALTER TABLE "DutyGenerationRun" ADD COLUMN     "approvedAt" TIMESTAMP(3),
ADD COLUMN     "approvedById" TEXT,
ADD COLUMN     "publishedAt" TIMESTAMP(3),
ADD COLUMN     "publishedById" TEXT,
ADD COLUMN     "rotationStateSnapshot" JSONB;

-- AddForeignKey
ALTER TABLE "DutyGenerationRun" ADD CONSTRAINT "DutyGenerationRun_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DutyGenerationRun" ADD CONSTRAINT "DutyGenerationRun_publishedById_fkey" FOREIGN KEY ("publishedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

