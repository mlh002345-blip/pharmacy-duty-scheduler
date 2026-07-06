/*
  Warnings:

  - Added the required column `regionId` to the `DutySchedule` table without a default value. This is not possible if the table is not empty.

*/
-- CreateTable
CREATE TABLE "DutyScheduleWarning" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "date" DATETIME NOT NULL,
    "message" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "scheduleId" TEXT NOT NULL,
    CONSTRAINT "DutyScheduleWarning_scheduleId_fkey" FOREIGN KEY ("scheduleId") REFERENCES "DutySchedule" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_DutyAssignment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "date" DATETIME NOT NULL,
    "weight" REAL NOT NULL DEFAULT 1,
    "note" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "dutyScheduleId" TEXT NOT NULL,
    "pharmacyId" TEXT NOT NULL,
    CONSTRAINT "DutyAssignment_dutyScheduleId_fkey" FOREIGN KEY ("dutyScheduleId") REFERENCES "DutySchedule" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "DutyAssignment_pharmacyId_fkey" FOREIGN KEY ("pharmacyId") REFERENCES "Pharmacy" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_DutyAssignment" ("createdAt", "date", "dutyScheduleId", "id", "pharmacyId", "updatedAt", "weight") SELECT "createdAt", "date", "dutyScheduleId", "id", "pharmacyId", "updatedAt", "weight" FROM "DutyAssignment";
DROP TABLE "DutyAssignment";
ALTER TABLE "new_DutyAssignment" RENAME TO "DutyAssignment";
CREATE INDEX "DutyAssignment_dutyScheduleId_idx" ON "DutyAssignment"("dutyScheduleId");
CREATE INDEX "DutyAssignment_pharmacyId_idx" ON "DutyAssignment"("pharmacyId");
CREATE TABLE "new_DutySchedule" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "month" INTEGER NOT NULL,
    "year" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "regionId" TEXT NOT NULL,
    CONSTRAINT "DutySchedule_regionId_fkey" FOREIGN KEY ("regionId") REFERENCES "Region" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_DutySchedule" ("createdAt", "id", "month", "status", "updatedAt", "year") SELECT "createdAt", "id", "month", "status", "updatedAt", "year" FROM "DutySchedule";
DROP TABLE "DutySchedule";
ALTER TABLE "new_DutySchedule" RENAME TO "DutySchedule";
CREATE UNIQUE INDEX "DutySchedule_year_month_regionId_key" ON "DutySchedule"("year", "month", "regionId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "DutyScheduleWarning_scheduleId_idx" ON "DutyScheduleWarning"("scheduleId");
