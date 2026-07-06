/*
  Warnings:

  - You are about to drop the column `isActive` on the `DutyRule` table. All the data in the column will be lost.
  - You are about to drop the column `name` on the `DutyRule` table. All the data in the column will be lost.
  - Added the required column `city` to the `Pharmacy` table without a default value. This is not possible if the table is not empty.
  - Added the required column `district` to the `Pharmacy` table without a default value. This is not possible if the table is not empty.
  - Added the required column `pharmacistName` to the `Pharmacy` table without a default value. This is not possible if the table is not empty.
  - Made the column `phone` on table `Pharmacy` required. This step will fail if there are existing NULL values in that column.
  - Added the required column `district` to the `Region` table without a default value. This is not possible if the table is not empty.

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_DutyRule" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "minDaysBetweenDuties" INTEGER NOT NULL DEFAULT 1,
    "weekdayWeight" REAL NOT NULL DEFAULT 1,
    "saturdayWeight" REAL NOT NULL DEFAULT 1.25,
    "sundayWeight" REAL NOT NULL DEFAULT 1.5,
    "officialHolidayWeight" REAL NOT NULL DEFAULT 2,
    "religiousHolidayWeight" REAL NOT NULL DEFAULT 2,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "regionId" TEXT NOT NULL,
    CONSTRAINT "DutyRule_regionId_fkey" FOREIGN KEY ("regionId") REFERENCES "Region" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_DutyRule" ("createdAt", "id", "minDaysBetweenDuties", "officialHolidayWeight", "regionId", "religiousHolidayWeight", "saturdayWeight", "sundayWeight", "updatedAt", "weekdayWeight") SELECT "createdAt", "id", "minDaysBetweenDuties", "officialHolidayWeight", "regionId", "religiousHolidayWeight", "saturdayWeight", "sundayWeight", "updatedAt", "weekdayWeight" FROM "DutyRule";
DROP TABLE "DutyRule";
ALTER TABLE "new_DutyRule" RENAME TO "DutyRule";
CREATE UNIQUE INDEX "DutyRule_regionId_key" ON "DutyRule"("regionId");
CREATE TABLE "new_Pharmacy" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "pharmacistName" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "district" TEXT NOT NULL,
    "mapUrl" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "regionId" TEXT NOT NULL,
    CONSTRAINT "Pharmacy_regionId_fkey" FOREIGN KEY ("regionId") REFERENCES "Region" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Pharmacy" ("address", "createdAt", "id", "isActive", "name", "phone", "regionId", "updatedAt") SELECT "address", "createdAt", "id", "isActive", "name", "phone", "regionId", "updatedAt" FROM "Pharmacy";
DROP TABLE "Pharmacy";
ALTER TABLE "new_Pharmacy" RENAME TO "Pharmacy";
CREATE INDEX "Pharmacy_regionId_idx" ON "Pharmacy"("regionId");
CREATE TABLE "new_Region" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "district" TEXT NOT NULL,
    "dailyDutyCount" INTEGER NOT NULL DEFAULT 1,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_Region" ("createdAt", "id", "name", "updatedAt") SELECT "createdAt", "id", "name", "updatedAt" FROM "Region";
DROP TABLE "Region";
ALTER TABLE "new_Region" RENAME TO "Region";
CREATE UNIQUE INDEX "Region_name_key" ON "Region"("name");
CREATE TABLE "new_Unavailability" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "startDate" DATETIME NOT NULL,
    "endDate" DATETIME NOT NULL,
    "reason" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "pharmacyId" TEXT NOT NULL,
    CONSTRAINT "Unavailability_pharmacyId_fkey" FOREIGN KEY ("pharmacyId") REFERENCES "Pharmacy" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Unavailability" ("createdAt", "endDate", "id", "pharmacyId", "reason", "startDate", "updatedAt") SELECT "createdAt", "endDate", "id", "pharmacyId", "reason", "startDate", "updatedAt" FROM "Unavailability";
DROP TABLE "Unavailability";
ALTER TABLE "new_Unavailability" RENAME TO "Unavailability";
CREATE INDEX "Unavailability_pharmacyId_idx" ON "Unavailability"("pharmacyId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
