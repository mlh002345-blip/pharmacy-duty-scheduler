-- CreateEnum
CREATE TYPE "DutyPlanVersionStatus" AS ENUM ('DRAFT', 'UNDER_REVIEW', 'APPROVED', 'ACTIVE', 'RETIRED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "DutyDayType" AS ENUM ('WEEKDAY', 'SATURDAY', 'SUNDAY', 'OFFICIAL_HOLIDAY', 'RELIGIOUS_HOLIDAY', 'HOLIDAY_EVE');

-- CreateEnum
CREATE TYPE "RotationStrategy" AS ENUM ('SEQUENTIAL', 'FAIRNESS_SCORE', 'WEIGHTED', 'MANUAL_ORDER');

-- DropIndex
DROP INDEX "DutyAssignment_dutyScheduleId_pharmacyId_date_key";

-- AlterTable
ALTER TABLE "DutyAssignment" ADD COLUMN     "shiftDefinitionId" TEXT,
ADD COLUMN     "slotKey" TEXT;

-- AlterTable
ALTER TABLE "DutySchedule" ADD COLUMN     "planVersionId" TEXT;

-- CreateTable
CREATE TABLE "DutyPlan" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "organizationId" TEXT NOT NULL,
    "regionId" TEXT NOT NULL,

    CONSTRAINT "DutyPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DutyPlanVersion" (
    "id" TEXT NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "status" "DutyPlanVersionStatus" NOT NULL DEFAULT 'DRAFT',
    "validFrom" TIMESTAMP(3) NOT NULL,
    "validTo" TIMESTAMP(3),
    "approvedAt" TIMESTAMP(3),
    "activatedAt" TIMESTAMP(3),
    "retiredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "planId" TEXT NOT NULL,

    CONSTRAINT "DutyPlanVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DayTypeRule" (
    "id" TEXT NOT NULL,
    "dayType" "DutyDayType" NOT NULL,
    "isServed" BOOLEAN NOT NULL DEFAULT true,
    "customDayCategory" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "planVersionId" TEXT NOT NULL,

    CONSTRAINT "DayTypeRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShiftDefinition" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "startMinute" INTEGER NOT NULL,
    "endMinute" INTEGER NOT NULL,
    "spansMidnight" BOOLEAN NOT NULL DEFAULT false,
    "defaultWeight" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "planVersionId" TEXT NOT NULL,

    CONSTRAINT "ShiftDefinition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SlotRequirement" (
    "id" TEXT NOT NULL,
    "name" TEXT,
    "requiredCount" INTEGER NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "dayTypeRuleId" TEXT NOT NULL,
    "shiftDefinitionId" TEXT NOT NULL,
    "rotationPoolId" TEXT,

    CONSTRAINT "SlotRequirement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RotationPool" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "strategy" "RotationStrategy" NOT NULL DEFAULT 'SEQUENTIAL',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "organizationId" TEXT NOT NULL,
    "regionId" TEXT,

    CONSTRAINT "RotationPool_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RotationPoolMembership" (
    "id" TEXT NOT NULL,
    "joinedAt" TIMESTAMP(3) NOT NULL,
    "leftAt" TIMESTAMP(3),
    "sortIndex" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "poolId" TEXT NOT NULL,
    "pharmacyId" TEXT NOT NULL,

    CONSTRAINT "RotationPoolMembership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RotationState" (
    "id" TEXT NOT NULL,
    "dayTypeScope" TEXT NOT NULL DEFAULT 'ALL',
    "currentRound" INTEGER NOT NULL DEFAULT 0,
    "carriedForward" JSONB NOT NULL DEFAULT '[]',
    "lockVersion" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "poolId" TEXT NOT NULL,
    "lastServedMembershipId" TEXT,

    CONSTRAINT "RotationState_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DutyPlan_organizationId_idx" ON "DutyPlan"("organizationId");

-- CreateIndex
CREATE INDEX "DutyPlan_regionId_idx" ON "DutyPlan"("regionId");

-- CreateIndex
CREATE INDEX "DutyPlanVersion_planId_status_idx" ON "DutyPlanVersion"("planId", "status");

-- CreateIndex
CREATE INDEX "DutyPlanVersion_validFrom_idx" ON "DutyPlanVersion"("validFrom");

-- CreateIndex
CREATE UNIQUE INDEX "DutyPlanVersion_planId_versionNumber_key" ON "DutyPlanVersion"("planId", "versionNumber");

-- CreateIndex
CREATE INDEX "DayTypeRule_planVersionId_dayType_idx" ON "DayTypeRule"("planVersionId", "dayType");

-- CreateIndex
CREATE INDEX "ShiftDefinition_planVersionId_sortOrder_idx" ON "ShiftDefinition"("planVersionId", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "ShiftDefinition_planVersionId_name_key" ON "ShiftDefinition"("planVersionId", "name");

-- CreateIndex
CREATE INDEX "SlotRequirement_dayTypeRuleId_sortOrder_idx" ON "SlotRequirement"("dayTypeRuleId", "sortOrder");

-- CreateIndex
CREATE INDEX "SlotRequirement_shiftDefinitionId_idx" ON "SlotRequirement"("shiftDefinitionId");

-- CreateIndex
CREATE INDEX "SlotRequirement_rotationPoolId_idx" ON "SlotRequirement"("rotationPoolId");

-- CreateIndex
CREATE INDEX "RotationPool_organizationId_idx" ON "RotationPool"("organizationId");

-- CreateIndex
CREATE INDEX "RotationPool_regionId_idx" ON "RotationPool"("regionId");

-- CreateIndex
CREATE UNIQUE INDEX "RotationPool_organizationId_name_key" ON "RotationPool"("organizationId", "name");

-- CreateIndex
CREATE INDEX "RotationPoolMembership_poolId_leftAt_idx" ON "RotationPoolMembership"("poolId", "leftAt");

-- CreateIndex
CREATE INDEX "RotationPoolMembership_pharmacyId_idx" ON "RotationPoolMembership"("pharmacyId");

-- CreateIndex
CREATE UNIQUE INDEX "RotationPoolMembership_poolId_pharmacyId_joinedAt_key" ON "RotationPoolMembership"("poolId", "pharmacyId", "joinedAt");

-- CreateIndex
CREATE INDEX "RotationState_poolId_idx" ON "RotationState"("poolId");

-- CreateIndex
CREATE UNIQUE INDEX "RotationState_poolId_dayTypeScope_key" ON "RotationState"("poolId", "dayTypeScope");

-- CreateIndex
CREATE INDEX "DutyAssignment_dutyScheduleId_pharmacyId_date_idx" ON "DutyAssignment"("dutyScheduleId", "pharmacyId", "date");

-- CreateIndex
CREATE INDEX "DutyAssignment_shiftDefinitionId_idx" ON "DutyAssignment"("shiftDefinitionId");

-- CreateIndex
CREATE INDEX "DutySchedule_planVersionId_idx" ON "DutySchedule"("planVersionId");

-- AddForeignKey
ALTER TABLE "DutySchedule" ADD CONSTRAINT "DutySchedule_planVersionId_fkey" FOREIGN KEY ("planVersionId") REFERENCES "DutyPlanVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DutyAssignment" ADD CONSTRAINT "DutyAssignment_shiftDefinitionId_fkey" FOREIGN KEY ("shiftDefinitionId") REFERENCES "ShiftDefinition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DutyPlan" ADD CONSTRAINT "DutyPlan_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DutyPlan" ADD CONSTRAINT "DutyPlan_regionId_fkey" FOREIGN KEY ("regionId") REFERENCES "Region"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DutyPlanVersion" ADD CONSTRAINT "DutyPlanVersion_planId_fkey" FOREIGN KEY ("planId") REFERENCES "DutyPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DayTypeRule" ADD CONSTRAINT "DayTypeRule_planVersionId_fkey" FOREIGN KEY ("planVersionId") REFERENCES "DutyPlanVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShiftDefinition" ADD CONSTRAINT "ShiftDefinition_planVersionId_fkey" FOREIGN KEY ("planVersionId") REFERENCES "DutyPlanVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SlotRequirement" ADD CONSTRAINT "SlotRequirement_dayTypeRuleId_fkey" FOREIGN KEY ("dayTypeRuleId") REFERENCES "DayTypeRule"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SlotRequirement" ADD CONSTRAINT "SlotRequirement_shiftDefinitionId_fkey" FOREIGN KEY ("shiftDefinitionId") REFERENCES "ShiftDefinition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SlotRequirement" ADD CONSTRAINT "SlotRequirement_rotationPoolId_fkey" FOREIGN KEY ("rotationPoolId") REFERENCES "RotationPool"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RotationPool" ADD CONSTRAINT "RotationPool_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RotationPool" ADD CONSTRAINT "RotationPool_regionId_fkey" FOREIGN KEY ("regionId") REFERENCES "Region"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RotationPoolMembership" ADD CONSTRAINT "RotationPoolMembership_poolId_fkey" FOREIGN KEY ("poolId") REFERENCES "RotationPool"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RotationPoolMembership" ADD CONSTRAINT "RotationPoolMembership_pharmacyId_fkey" FOREIGN KEY ("pharmacyId") REFERENCES "Pharmacy"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RotationState" ADD CONSTRAINT "RotationState_poolId_fkey" FOREIGN KEY ("poolId") REFERENCES "RotationPool"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RotationState" ADD CONSTRAINT "RotationState_lastServedMembershipId_fkey" FOREIGN KEY ("lastServedMembershipId") REFERENCES "RotationPoolMembership"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Raw SQL not expressible in Prisma schema language: PARTIAL UNIQUE INDEXES.
-- (Documented in docs/architecture/DUTY_RULES_V2_CORE_SCHEMA.md.)
--
-- 1) DutyAssignment uniqueness, split by V1/V2 rows. A plain composite
--    unique over (dutyScheduleId, pharmacyId, date, shiftDefinitionId)
--    would NOT preserve the V1 guarantee: PostgreSQL treats NULLs as
--    distinct, so legacy rows (shiftDefinitionId IS NULL) could duplicate
--    freely. Instead:
--      - legacy rows keep the EXACT pre-V2 guarantee (one pharmacy per
--        schedule+date), including the concurrent manual-edit race the
--        original constraint exists to catch;
--      - V2 rows are unique per schedule+date+shift, deliberately
--        ALLOWING the same pharmacy in two DIFFERENT shifts on one date
--        (a future configurable SHIFT_MUTUAL_EXCLUSION rule governs
--        that, never the database).
CREATE UNIQUE INDEX "DutyAssignment_legacy_unique"
  ON "DutyAssignment" ("dutyScheduleId", "pharmacyId", "date")
  WHERE "shiftDefinitionId" IS NULL;

CREATE UNIQUE INDEX "DutyAssignment_v2_shift_unique"
  ON "DutyAssignment" ("dutyScheduleId", "pharmacyId", "date", "shiftDefinitionId")
  WHERE "shiftDefinitionId" IS NOT NULL;

-- 2) DayTypeRule uniqueness, split by customDayCategory presence: one
--    plain row per (version, dayType), plus at most one row per
--    (version, dayType, category) for future custom categories. A single
--    nullable composite unique would allow duplicate plain rows for the
--    same NULL-distinctness reason.
CREATE UNIQUE INDEX "DayTypeRule_plain_unique"
  ON "DayTypeRule" ("planVersionId", "dayType")
  WHERE "customDayCategory" IS NULL;

CREATE UNIQUE INDEX "DayTypeRule_custom_unique"
  ON "DayTypeRule" ("planVersionId", "dayType", "customDayCategory")
  WHERE "customDayCategory" IS NOT NULL;
