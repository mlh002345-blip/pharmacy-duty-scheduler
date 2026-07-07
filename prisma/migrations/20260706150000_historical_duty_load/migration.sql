-- CreateEnum
CREATE TYPE "HistoricalMatchStatus" AS ENUM ('MATCHED', 'UNMATCHED', 'IGNORED');

-- CreateTable
CREATE TABLE "HistoricalDutyImportBatch" (
    "id" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "rowCount" INTEGER NOT NULL DEFAULT 0,
    "matchedCount" INTEGER NOT NULL DEFAULT 0,
    "unmatchedCount" INTEGER NOT NULL DEFAULT 0,
    "warningCount" INTEGER NOT NULL DEFAULT 0,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "importedById" TEXT,

    CONSTRAINT "HistoricalDutyImportBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HistoricalDutyRecord" (
    "id" TEXT NOT NULL,
    "rowNumber" INTEGER NOT NULL,
    "dutyDate" TIMESTAMP(3) NOT NULL,
    "rawPharmacyName" TEXT NOT NULL,
    "rawRegionName" TEXT,
    "rawDutyType" TEXT,
    "rawPhone" TEXT,
    "rawAddress" TEXT,
    "rawNote" TEXT,
    "dutyType" TEXT NOT NULL,
    "weight" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "matchStatus" "HistoricalMatchStatus" NOT NULL DEFAULT 'UNMATCHED',
    "warningMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "batchId" TEXT NOT NULL,
    "pharmacyId" TEXT,
    "regionId" TEXT,

    CONSTRAINT "HistoricalDutyRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DutyBalanceAdjustment" (
    "id" TEXT NOT NULL,
    "points" DOUBLE PRECISION NOT NULL,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "pharmacyId" TEXT NOT NULL,
    "createdById" TEXT,

    CONSTRAINT "DutyBalanceAdjustment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "HistoricalDutyRecord_pharmacyId_idx" ON "HistoricalDutyRecord"("pharmacyId");

-- CreateIndex
CREATE INDEX "HistoricalDutyRecord_regionId_idx" ON "HistoricalDutyRecord"("regionId");

-- CreateIndex
CREATE INDEX "HistoricalDutyRecord_dutyDate_idx" ON "HistoricalDutyRecord"("dutyDate");

-- CreateIndex
CREATE INDEX "HistoricalDutyRecord_batchId_idx" ON "HistoricalDutyRecord"("batchId");

-- CreateIndex
CREATE INDEX "HistoricalDutyRecord_matchStatus_idx" ON "HistoricalDutyRecord"("matchStatus");

-- CreateIndex
CREATE INDEX "DutyBalanceAdjustment_pharmacyId_idx" ON "DutyBalanceAdjustment"("pharmacyId");

-- AddForeignKey
ALTER TABLE "HistoricalDutyImportBatch" ADD CONSTRAINT "HistoricalDutyImportBatch_importedById_fkey" FOREIGN KEY ("importedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HistoricalDutyRecord" ADD CONSTRAINT "HistoricalDutyRecord_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "HistoricalDutyImportBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HistoricalDutyRecord" ADD CONSTRAINT "HistoricalDutyRecord_pharmacyId_fkey" FOREIGN KEY ("pharmacyId") REFERENCES "Pharmacy"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HistoricalDutyRecord" ADD CONSTRAINT "HistoricalDutyRecord_regionId_fkey" FOREIGN KEY ("regionId") REFERENCES "Region"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DutyBalanceAdjustment" ADD CONSTRAINT "DutyBalanceAdjustment_pharmacyId_fkey" FOREIGN KEY ("pharmacyId") REFERENCES "Pharmacy"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DutyBalanceAdjustment" ADD CONSTRAINT "DutyBalanceAdjustment_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

