-- Idempotency & Retry Safety follow-up: close two check-then-act races
-- found in the Transaction & Consistency Boundaries sweep by moving
-- duplicate detection from an application-level findFirst() into a real
-- DB-backed unique constraint.
--
-- 1. HistoricalDutyImportBatch.fingerprint — a deterministic SHA-256
--    fingerprint of the accepted import rows (computeImportFingerprint in
--    src/app/(dashboard)/gecmis-nobetler/actions.ts). Previously this was
--    stored in the free-text `note` column with no uniqueness, so two
--    concurrent identical import confirmations could both pass the
--    pre-check and both commit, double-counting historical duty balance.
--    `note` is untouched and remains available for human-readable notes.
--
-- 2. DutyRequest.dedupKey — a deterministic key computed only for
--    PUBLIC_LINK submissions (pharmacyId + requestType + normalized
--    startDate/endDate/explanation + source), set only while the request
--    is PENDING/LATE and cleared back to NULL by reviewDutyRequestAction
--    once the request leaves that state. Nullable + unique means any
--    number of reviewed/closed requests can coexist with NULL dedupKey,
--    while at most one open (PENDING/LATE) request can hold a given key —
--    closing a request re-opens that exact combination for a future
--    genuinely-new submission.
--
-- Preflight: both new columns are nullable and start out NULL for every
-- existing row (no backfill performed or required — neither column is
-- derived from any other column in a way that's meaningful to
-- reconstruct for historical rows, and NULL correctly means "no
-- fingerprint on record yet" / "not an open public request"). Before
-- applying in an environment with existing data, confirm there are no
-- pre-existing NULL-only duplicates that would violate intent (there
-- cannot be a uniqueness *violation* from an all-NULL backfill, since
-- Postgres unique indexes treat NULL as distinct from every other NULL —
-- the following queries are advisory only, to sanity-check row counts
-- before/after, and should return 0 rows on every environment before
-- this migration:
--
--   SELECT COUNT(*) FROM "HistoricalDutyImportBatch" WHERE "fingerprint" IS NOT NULL;
--   SELECT COUNT(*) FROM "DutyRequest" WHERE "dedupKey" IS NOT NULL;

-- AlterTable
ALTER TABLE "DutyRequest" ADD COLUMN     "dedupKey" TEXT;

-- AlterTable
ALTER TABLE "HistoricalDutyImportBatch" ADD COLUMN     "fingerprint" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "DutyRequest_dedupKey_key" ON "DutyRequest"("dedupKey");

-- CreateIndex
CREATE UNIQUE INDEX "HistoricalDutyImportBatch_fingerprint_key" ON "HistoricalDutyImportBatch"("fingerprint");
