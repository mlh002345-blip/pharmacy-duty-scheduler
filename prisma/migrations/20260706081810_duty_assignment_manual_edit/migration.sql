-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_DutyAssignment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "date" DATETIME NOT NULL,
    "weight" REAL NOT NULL DEFAULT 1,
    "note" TEXT,
    "isManual" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "dutyScheduleId" TEXT NOT NULL,
    "pharmacyId" TEXT NOT NULL,
    CONSTRAINT "DutyAssignment_dutyScheduleId_fkey" FOREIGN KEY ("dutyScheduleId") REFERENCES "DutySchedule" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "DutyAssignment_pharmacyId_fkey" FOREIGN KEY ("pharmacyId") REFERENCES "Pharmacy" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_DutyAssignment" ("createdAt", "date", "dutyScheduleId", "id", "note", "pharmacyId", "updatedAt", "weight") SELECT "createdAt", "date", "dutyScheduleId", "id", "note", "pharmacyId", "updatedAt", "weight" FROM "DutyAssignment";
DROP TABLE "DutyAssignment";
ALTER TABLE "new_DutyAssignment" RENAME TO "DutyAssignment";
CREATE INDEX "DutyAssignment_dutyScheduleId_idx" ON "DutyAssignment"("dutyScheduleId");
CREATE INDEX "DutyAssignment_pharmacyId_idx" ON "DutyAssignment"("pharmacyId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
