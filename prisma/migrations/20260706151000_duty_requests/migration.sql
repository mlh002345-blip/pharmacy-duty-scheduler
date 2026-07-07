-- CreateEnum
CREATE TYPE "DutyRequestType" AS ENUM ('CANNOT_DUTY', 'PREFER_DUTY', 'SWAP_REQUEST', 'EMERGENCY_EXCUSE');

-- CreateEnum
CREATE TYPE "DutyRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED', 'LATE');

-- CreateEnum
CREATE TYPE "DutyRequestSource" AS ENUM ('ADMIN_ENTRY', 'PUBLIC_LINK', 'IMPORT');

-- AlterTable
ALTER TABLE "Pharmacy" ADD COLUMN     "requestToken" TEXT;

-- CreateTable
CREATE TABLE "DutyRequest" (
    "id" TEXT NOT NULL,
    "requestType" "DutyRequestType" NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "explanation" TEXT NOT NULL,
    "status" "DutyRequestStatus" NOT NULL DEFAULT 'PENDING',
    "source" "DutyRequestSource" NOT NULL DEFAULT 'ADMIN_ENTRY',
    "reviewNote" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "pharmacyId" TEXT NOT NULL,
    "regionId" TEXT,
    "reviewedById" TEXT,

    CONSTRAINT "DutyRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DutyRequest_pharmacyId_idx" ON "DutyRequest"("pharmacyId");

-- CreateIndex
CREATE INDEX "DutyRequest_regionId_idx" ON "DutyRequest"("regionId");

-- CreateIndex
CREATE INDEX "DutyRequest_status_idx" ON "DutyRequest"("status");

-- CreateIndex
CREATE INDEX "DutyRequest_requestType_idx" ON "DutyRequest"("requestType");

-- CreateIndex
CREATE INDEX "DutyRequest_startDate_idx" ON "DutyRequest"("startDate");

-- CreateIndex
CREATE INDEX "DutyRequest_endDate_idx" ON "DutyRequest"("endDate");

-- CreateIndex
CREATE UNIQUE INDEX "Pharmacy_requestToken_key" ON "Pharmacy"("requestToken");

-- AddForeignKey
ALTER TABLE "DutyRequest" ADD CONSTRAINT "DutyRequest_pharmacyId_fkey" FOREIGN KEY ("pharmacyId") REFERENCES "Pharmacy"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DutyRequest" ADD CONSTRAINT "DutyRequest_regionId_fkey" FOREIGN KEY ("regionId") REFERENCES "Region"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DutyRequest" ADD CONSTRAINT "DutyRequest_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

