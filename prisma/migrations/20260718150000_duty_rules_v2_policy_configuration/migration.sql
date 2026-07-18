-- CreateEnum
CREATE TYPE "HolidayEveWeightSource" AS ENUM ('CONFIGURED', 'UNDERLYING_WEEKDAY');

-- CreateEnum
CREATE TYPE "HolidayOverlapResolutionMode" AS ENUM ('NATIVE_PRECEDENCE', 'V1_LAST_INPUT_WINS');

-- AlterTable
ALTER TABLE "DayTypeRule" ADD COLUMN     "weight" DOUBLE PRECISION;

-- AlterTable
ALTER TABLE "DutyPlanVersion" ADD COLUMN     "holidayEveWeightSource" "HolidayEveWeightSource" NOT NULL DEFAULT 'CONFIGURED',
ADD COLUMN     "holidayOverlapResolutionMode" "HolidayOverlapResolutionMode" NOT NULL DEFAULT 'NATIVE_PRECEDENCE',
ADD COLUMN     "minDaysBetweenDuties" INTEGER,
ADD COLUMN     "relaxMinIntervalWhenInsufficient" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "sameDaySecondAssignmentAllowed" BOOLEAN NOT NULL DEFAULT false;

