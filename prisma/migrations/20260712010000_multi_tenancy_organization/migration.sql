-- Organization-level multi-tenancy (single atomic migration).
--
-- This app is pre-pilot — the only data in any deployed database at
-- this point is demo/seed/fixture data, never a real pharmacist
-- chamber's live data — so a single atomic migration (add columns
-- nullable -> backfill in the same transaction -> add NOT NULL/unique
-- constraints) is safer and simpler than a multi-deploy staged rollout:
-- there is no live traffic window where old code would need to run
-- against a partially-migrated schema. See
-- docs/architecture/MULTI_TENANCY.md for the full design and
-- docs/operations/ORGANIZATION_ONBOARDING.md for what to do once a real
-- chamber's data needs to be split into its own Organization row later.
--
-- One bootstrap Organization is created here for whatever data already
-- exists (name/province deliberately generic — "Bilecik" is never
-- hardcoded in a migration; renaming the bootstrap organization to a
-- real chamber's name is an explicit operator action via
-- `npm run org:rename`, see scripts/organizations/rename-organization.ts).
--
-- Prisma's migrate deploy already wraps this whole file in one
-- transaction for PostgreSQL (no CONCURRENTLY statements are used here),
-- so there is no explicit BEGIN/COMMIT — matching every other migration
-- in this repo.

-- CreateEnum
CREATE TYPE "PharmacyImportBatchStatus" AS ENUM ('PREVIEWED', 'IMPORTED', 'EXPIRED');
CREATE TYPE "PharmacyImportRowStatus" AS ENUM ('READY', 'INVALID', 'DUPLICATE_IN_FILE', 'ALREADY_EXISTS', 'UNKNOWN_REGION');

-- AlterEnum: PLATFORM_ADMIN never belongs to an organization (User.organizationId
-- stays nullable specifically to accommodate this role).
ALTER TYPE "UserRole" ADD VALUE 'PLATFORM_ADMIN';

-- CreateTable: Organization
CREATE TABLE "Organization" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "province" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Organization_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Organization_slug_key" ON "Organization"("slug");
CREATE INDEX "Organization_isActive_idx" ON "Organization"("isActive");

-- Bootstrap organization for pre-existing data (generic name/province —
-- never "Bilecik" — see header comment).
INSERT INTO "Organization" ("id", "name", "province", "slug", "isActive", "createdAt", "updatedAt")
VALUES ('org_bootstrap_default', 'Varsayılan Oda', 'Bilinmiyor', 'varsayilan-oda', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);

-- AlterTable: add nullable organizationId columns first (backfilled below,
-- then tightened to NOT NULL in the same transaction).
ALTER TABLE "User" ADD COLUMN "organizationId" TEXT;
ALTER TABLE "Region" ADD COLUMN "organizationId" TEXT;
ALTER TABLE "AuditLog" ADD COLUMN "organizationId" TEXT;
ALTER TABLE "HistoricalDutyImportBatch" ADD COLUMN "organizationId" TEXT;
ALTER TABLE "Pharmacy" ADD COLUMN "normalizedName" TEXT;

-- Backfill: every existing row belongs to the bootstrap organization.
-- (No PLATFORM_ADMIN can exist yet — this migration introduces the role —
-- so backfilling every User row unconditionally is correct.)
UPDATE "User" SET "organizationId" = 'org_bootstrap_default';
UPDATE "Region" SET "organizationId" = 'org_bootstrap_default';
UPDATE "AuditLog" SET "organizationId" = 'org_bootstrap_default';
UPDATE "HistoricalDutyImportBatch" SET "organizationId" = 'org_bootstrap_default';

-- Backfill normalizedName: mirrors src/lib/historical/normalize.ts's
-- normalizeText (trim, collapse whitespace, lowercase) closely enough for
-- existing rows; every future write goes through the real TS
-- implementation, which is Turkish-locale-aware in a way plain SQL
-- lower() is not (İ/I handling) — acceptable for a one-time backfill of
-- pre-existing demo data, re-verified by the row count / uniqueness
-- validation step below.
UPDATE "Pharmacy" SET "normalizedName" = lower(trim(regexp_replace("name", '\s+', ' ', 'g')));

-- Validate: fail the whole transaction (rolling back everything above) if
-- any row could not be backfilled, or if backfilled values collide.
DO $$
DECLARE
  null_count INTEGER;
  dup_regions INTEGER;
  dup_pharmacies INTEGER;
BEGIN
  SELECT count(*) INTO null_count FROM "User" WHERE "organizationId" IS NULL;
  IF null_count > 0 THEN
    RAISE EXCEPTION 'multi_tenancy backfill: % User rows have no organizationId', null_count;
  END IF;

  SELECT count(*) INTO null_count FROM "Region" WHERE "organizationId" IS NULL;
  IF null_count > 0 THEN
    RAISE EXCEPTION 'multi_tenancy backfill: % Region rows have no organizationId', null_count;
  END IF;

  SELECT count(*) INTO null_count FROM "AuditLog" WHERE "organizationId" IS NULL;
  IF null_count > 0 THEN
    RAISE EXCEPTION 'multi_tenancy backfill: % AuditLog rows have no organizationId', null_count;
  END IF;

  SELECT count(*) INTO null_count FROM "HistoricalDutyImportBatch" WHERE "organizationId" IS NULL;
  IF null_count > 0 THEN
    RAISE EXCEPTION 'multi_tenancy backfill: % HistoricalDutyImportBatch rows have no organizationId', null_count;
  END IF;

  SELECT count(*) INTO null_count FROM "Pharmacy" WHERE "normalizedName" IS NULL OR "normalizedName" = '';
  IF null_count > 0 THEN
    RAISE EXCEPTION 'multi_tenancy backfill: % Pharmacy rows have no normalizedName', null_count;
  END IF;

  SELECT count(*) INTO dup_regions FROM (
    SELECT "organizationId", "name" FROM "Region" GROUP BY "organizationId", "name" HAVING count(*) > 1
  ) t;
  IF dup_regions > 0 THEN
    RAISE EXCEPTION 'multi_tenancy backfill: % duplicate (organizationId, name) Region groups would violate the new unique constraint', dup_regions;
  END IF;

  SELECT count(*) INTO dup_pharmacies FROM (
    SELECT "regionId", "normalizedName" FROM "Pharmacy" GROUP BY "regionId", "normalizedName" HAVING count(*) > 1
  ) t;
  IF dup_pharmacies > 0 THEN
    RAISE EXCEPTION 'multi_tenancy backfill: % duplicate (regionId, normalizedName) Pharmacy groups would violate the new unique constraint', dup_pharmacies;
  END IF;
END $$;

-- Tighten to NOT NULL now that every row is backfilled and validated.
-- User.organizationId stays nullable (PLATFORM_ADMIN only).
ALTER TABLE "Region" ALTER COLUMN "organizationId" SET NOT NULL;
ALTER TABLE "AuditLog" ALTER COLUMN "organizationId" SET NOT NULL;
ALTER TABLE "HistoricalDutyImportBatch" ALTER COLUMN "organizationId" SET NOT NULL;
ALTER TABLE "Pharmacy" ALTER COLUMN "normalizedName" SET NOT NULL;

-- DropIndex: Region.name was globally unique; now organization-scoped.
DROP INDEX "Region_name_key";

-- CreateIndex (organization-scoped uniqueness + FK lookup indexes)
CREATE UNIQUE INDEX "Region_organizationId_name_key" ON "Region"("organizationId", "name");
CREATE INDEX "Region_organizationId_idx" ON "Region"("organizationId");
CREATE UNIQUE INDEX "Pharmacy_regionId_normalizedName_key" ON "Pharmacy"("regionId", "normalizedName");
CREATE INDEX "User_organizationId_idx" ON "User"("organizationId");
CREATE INDEX "AuditLog_organizationId_createdAt_idx" ON "AuditLog"("organizationId", "createdAt");
CREATE INDEX "HistoricalDutyImportBatch_organizationId_idx" ON "HistoricalDutyImportBatch"("organizationId");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Region" ADD CONSTRAINT "Region_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "HistoricalDutyImportBatch" ADD CONSTRAINT "HistoricalDutyImportBatch_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CreateTable: PharmacyImportBatch / PharmacyImportRow (fresh, no backfill).
CREATE TABLE "PharmacyImportBatch" (
    "id" TEXT NOT NULL,
    "status" "PharmacyImportBatchStatus" NOT NULL DEFAULT 'PREVIEWED',
    "sanitizedFileName" TEXT NOT NULL,
    "fileSize" INTEGER NOT NULL,
    "totalRows" INTEGER NOT NULL,
    "readyRows" INTEGER NOT NULL,
    "invalidRows" INTEGER NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "organizationId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,

    CONSTRAINT "PharmacyImportBatch_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "PharmacyImportBatch_organizationId_status_idx" ON "PharmacyImportBatch"("organizationId", "status");
CREATE INDEX "PharmacyImportBatch_expiresAt_idx" ON "PharmacyImportBatch"("expiresAt");
ALTER TABLE "PharmacyImportBatch" ADD CONSTRAINT "PharmacyImportBatch_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PharmacyImportBatch" ADD CONSTRAINT "PharmacyImportBatch_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "PharmacyImportRow" (
    "id" TEXT NOT NULL,
    "rowNumber" INTEGER NOT NULL,
    "pharmacyName" TEXT NOT NULL,
    "normalizedPharmacyName" TEXT NOT NULL,
    "pharmacistName" TEXT,
    "phone" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "status" "PharmacyImportRowStatus" NOT NULL,
    "safeErrorCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "batchId" TEXT NOT NULL,
    "regionId" TEXT,

    CONSTRAINT "PharmacyImportRow_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "PharmacyImportRow_batchId_idx" ON "PharmacyImportRow"("batchId");
CREATE INDEX "PharmacyImportRow_regionId_idx" ON "PharmacyImportRow"("regionId");
ALTER TABLE "PharmacyImportRow" ADD CONSTRAINT "PharmacyImportRow_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "PharmacyImportBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PharmacyImportRow" ADD CONSTRAINT "PharmacyImportRow_regionId_fkey" FOREIGN KEY ("regionId") REFERENCES "Region"("id") ON DELETE SET NULL ON UPDATE CASCADE;
