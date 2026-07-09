# Transaction & Consistency Boundaries

Date: 2026-07-09 (audit + fixes), same branch (`deploy/postgresql-demo`).

## Scope

Audited every operation that updates more than one thing (multiple
rows/tables, DB + cache, DB + external service) for transaction/saga/
outbox/compensation coverage, and specifically hunted for: cache updated
before/without the DB commit; events published for changes that then
roll back; cross-service writes with no reconciliation. This app has no
external services, queue, or event bus (confirmed in a prior sweep), so
the real surface was: `revalidatePath`/redirect ordering relative to
`$transaction`, multi-write operations outside a shared transaction, and
two check-then-act dedup races introduced by the prior "Idempotency &
Retry Safety" fix turn. This document covers the audit and the two fixes
from it.

## Transaction boundary inventory

~30 `revalidatePath`/`redirectWithMessage` call sites across every
`src/app/**/actions.ts` file were checked against their preceding
`$transaction` call; every multi-write server action was checked for
whether all its writes (plus `writeAuditLog`) share one `$transaction`
callback.

## Finding table

| # | Finding | Status |
|---|---|---|
| 1 | Audit log write is always inside the same transaction as its business mutation | Clean |
| 2 | `revalidatePath`/redirect always fire after the transaction commits, never before/interleaved | Clean |
| 3 | Historical import fingerprint check-then-act race | **Fixed** |
| 4 | Public duty request dedup check-then-act race | **Fixed** |
| 5 | Data health cache stale up to 60 seconds | Documented acceptable (unchanged from prior sweep) |
| 6 | No external services/events/outbox anywhere in the app | Clean/absent |

---

### 1. Audit log write atomicity — Clean

Every one of `writeAuditLog`'s ~15 call sites (across `eczaneler`,
`bolgeler`, `mazeretler`, `kurallar`, `tatil-gunleri`, `kullanicilar`,
`cizelgeler`, `assignment-actions.ts`, `gecmis-nobetler`,
`nobet-talepleri`, and `generate-and-save-duty-schedule.ts`) passes the
transaction client `tx`, never the top-level `prisma` client. If the
business mutation rolls back, the audit entry documenting it rolls back
with it — no case of an audit log surviving a rolled-back mutation, or a
mutation committing without its audit trail.

### 2. `revalidatePath`/redirect ordering — Clean

In every server action inspected, `revalidatePath(...)` and
`redirectWithMessage(...)`/`redirect(...)` are plain sequential
statements placed strictly *after* the `await prisma.$transaction(...)`
(or, for schedule generation, `await generateAndSaveDutySchedule(...)`)
has resolved. Since a thrown transaction aborts the function before
reaching that line, there is no path where Next's route cache is
invalidated, or a success message shown, for a write that didn't
actually commit.

---

### 3. Historical import fingerprint check-then-act race — **Fixed**

**Before:** `historicalImportAction` computed a SHA-256 fingerprint of
the accepted import rows and checked for a duplicate with
`prisma.historicalDutyImportBatch.findFirst({ where: { note: fingerprint } })`
*before* the `$transaction` that creates the batch. `note` had no unique
constraint, so two concurrent identical confirm submissions could both
pass the pre-check before either committed, producing two full duplicate
`HistoricalDutyImportBatch` + `HistoricalDutyRecord` sets and silently
double-counting historical duty balance.

**Fix — migration added:** `HistoricalDutyImportBatch.fingerprint String? @unique`
is a new, dedicated column (`note` is untouched and remains available
for human-readable notes — it was never relied on for uniqueness in the
final design). `historicalImportAction` still computes the same
deterministic fingerprint and writes it directly on `create()` inside
the transaction; the separate pre-check `findFirst` was removed
entirely. If a duplicate fingerprint is submitted (whether via retry or
genuine concurrency), `tx.historicalDutyImportBatch.create()` throws a
Prisma P2002 error, which aborts the transaction *before*
`tx.historicalDutyRecord.createMany()` runs (same transaction, so no
records are ever written for the rejected batch) and is caught in the
action to return the existing friendly message: "Bu geçmiş nöbet
aktarımı daha önce içeri alınmış." Preview mode is unaffected — the
fingerprint/uniqueness logic only runs in the `mode === "import"`
confirm path.

**Verified against real Postgres** (see Verification section): two
inserts with the same `fingerprint` — the second fails with
`duplicate key value violates unique constraint
"HistoricalDutyImportBatch_fingerprint_key"`, confirming the DB, not
just application code, now blocks the race.

### 4. Public duty request dedup check-then-act race — **Fixed**

**Before:** `createPublicDutyRequestAction` checked for a duplicate with
`prisma.dutyRequest.findFirst(...)` before a bare, non-transactional
`prisma.dutyRequest.create(...)`. No unique constraint spanned the
practical business key, so two genuinely concurrent public submissions
could both pass the check and both create a `PENDING` row.

**Fix — migration added:** `DutyRequest.dedupKey String? @unique`. A new
helper, `computePublicRequestDedupKey()` (moved to
`src/lib/duty-requests/dedup-key.ts` — a `"use server"` file can only
export async functions, so this pure/sync helper lives in its own
module, imported by the action), builds a deterministic SHA-256 key from
`pharmacyId` (still derived only from the token, never client-supplied —
unchanged), `requestType`, normalized (`toISOString()`) `startDate`/
`endDate`, and normalized (`trim().toLowerCase()`) `explanation`, plus a
fixed `"PUBLIC_LINK"` suffix. `createPublicDutyRequestAction` sets this
key on `create()` (no separate pre-check `findFirst`); a P2002 on
`dedupKey` is caught and returns the existing friendly message: "Bu
talep daha önce alınmış. Lütfen mevcut talebinizin incelenmesini
bekleyin." The `MAX_OPEN_PUBLIC_REQUESTS` cap check is unchanged and
still runs before the create attempt.

**Business behavior preserved — open vs. closed requests:**
`dedupKey` is only meaningful while a request is open. `reviewDutyRequestAction`
(`src/app/(dashboard)/nobet-talepleri/actions.ts`) now sets `dedupKey:
null` in the same conditional `updateMany` that transitions a request
out of `PENDING`/`LATE` (the existing double-review guard from the prior
"Idempotency & Retry Safety" sweep — `where: { status: { in: [PENDING,
LATE] } }` — is unchanged). Since Postgres treats every `NULL` in a
unique index as distinct from every other `NULL`, any number of
reviewed/closed requests can coexist with a `NULL` dedupKey, while at
most one *open* request can hold a given key. This means: closing a
request (approve/reject/cancel) immediately frees that exact
pharmacy+type+dates+explanation combination for a genuinely new future
submission, without any cleanup job or TTL.

**Admin `createDutyRequestAction`:** left as documented-only (per the
prior sweep) — adopting the same `dedupKey` policy for admin-entered
requests was judged out of scope for this pass since staff-entered
duplicates may be intentional (see prior sweep's reasoning); flagged as
a candidate for the same fix if it's ever revisited.

**Verified against real Postgres**: two inserts with the same
`dedupKey` while both rows are conceptually "open" — the second fails
with `duplicate key value violates unique constraint
"DutyRequest_dedupKey_key"`. After clearing the first row's `dedupKey`
to `NULL` (simulating a review), inserting a fresh row with the same key
value succeeds — confirming both the block and the release work exactly
as designed at the database level, not just in application code.

---

## Migration added

`prisma/migrations/20260709090000_idempotency_fingerprint_dedup_key/migration.sql`:

```sql
ALTER TABLE "DutyRequest" ADD COLUMN "dedupKey" TEXT;
ALTER TABLE "HistoricalDutyImportBatch" ADD COLUMN "fingerprint" TEXT;
CREATE UNIQUE INDEX "DutyRequest_dedupKey_key" ON "DutyRequest"("dedupKey");
CREATE UNIQUE INDEX "HistoricalDutyImportBatch_fingerprint_key" ON "HistoricalDutyImportBatch"("fingerprint");
```

Both new columns are nullable; existing rows get `NULL` for both with no
backfill performed or required (neither column is derivable from
existing data — `NULL` correctly means "no fingerprint on record yet" /
"not an open public request"). A `NULL`-only backfill can never violate
a Postgres unique index (NULLs are always distinct from one another), so
this migration is safe to apply against a database with existing rows
with zero risk of a migration-time constraint violation.

### Preflight (advisory only — expected to return 0 on every environment before this migration)

```sql
SELECT COUNT(*) FROM "HistoricalDutyImportBatch" WHERE "fingerprint" IS NOT NULL;
SELECT COUNT(*) FROM "DutyRequest" WHERE "dedupKey" IS NOT NULL;
```

## Deployment notes (Railway)

1. Deploy the new application code (this branch).
2. Run `npx prisma migrate deploy` against the production `DATABASE_URL`
   (Railway's deploy step, or manually via `railway run npx prisma
   migrate deploy` if migrations aren't wired into the build/start
   command already). This applies only the single new migration —
   `ADD COLUMN` + `CREATE UNIQUE INDEX`, both fast, non-blocking DDL at
   this table size (no `NOT NULL`, no data rewrite).
3. No backfill script needed — see above.
4. No environment variable changes required.

## Remaining documented-only items (unchanged from prior sweeps, restated for completeness)

- **Data health cache stale up to 60 seconds** — the read-only TTL cache
  in `src/lib/health/data-health.ts` (from the "Algorithmic Complexity &
  Hot Paths" sweep) is never written to by any mutation and was already
  reviewed/accepted as intentionally-stale, informational-only. Re-
  confirmed in this sweep as the only cache in the app.
- **No external services/events/outbox** — confirmed (again) via a
  repo-wide scan for `fetch(`, `axios`, email/SMS/payment/storage SDKs:
  zero matches outside the one same-origin export-download `fetch` (from
  the "External Calls, Timeouts & Resilience" sweep, already fixed with
  a timeout in a separate pass). There is no distributed-write surface
  in this application to reconcile.
- **Admin `createDutyRequestAction` duplicate creates** — still
  documented-only (see item 4 above and the prior "Idempotency & Retry
  Safety" doc).

## Verification performed

- `npx prisma generate` — regenerated client with the new
  `fingerprint`/`dedupKey` fields
- `npx prisma migrate deploy` against a real local PostgreSQL 16
  instance — the new migration applies cleanly on top of the 5
  pre-existing migrations; `npx prisma migrate status` reports "Database
  schema is up to date!" afterward
- `npx tsc --noEmit` — clean
- `npm run lint` — clean
- `npm test` — 205/205 passing (16 new/updated tests across
  `eczane-talep/[token]/actions.test.ts`,
  `gecmis-nobetler/actions.test.ts`, and
  `nobet-talepleri/actions.test.ts`, covering: P2002-on-fingerprint /
  P2002-on-dedupKey → friendly message; no `HistoricalDutyRecord` rows
  created on a rejected duplicate; first import/request still succeeds;
  fingerprint stored on the dedicated field, not `note`; different
  payload/date/type/explanation produces a different key and still
  creates a new row; `reviewDutyRequestAction` clears `dedupKey` to
  `null`; non-P2002 errors still propagate instead of being swallowed)
- `npm run build` (against the real local Postgres, with the migration
  applied) — production build succeeds, all routes registered
- **Live verification against real PostgreSQL** (this environment has
  no Postgres by default; started `postgresql@16` locally, created a
  scratch database, applied all 6 migrations including the new one, and
  seeded it):
  - Ran `createPublicDutyRequestAction` directly (no mocks) against the
    live database via a throwaway script: first submit succeeds
    ("Talebiniz eczacı odası incelemesine gönderildi."), an identical
    second submit is blocked with the friendly duplicate message, and a
    submit with a different date range still creates a new row (2 total
    rows for the same explanation text, one per distinct date range).
  - Verified the two new unique constraints directly against Postgres
    via `psql`: duplicate `fingerprint` insert → blocked with
    `duplicate key value violates unique constraint
    "HistoricalDutyImportBatch_fingerprint_key"`; duplicate open
    `dedupKey` insert → blocked with `duplicate key value violates
    unique constraint "DutyRequest_dedupKey_key"`; after clearing the
    first row's `dedupKey` to `NULL` (simulating
    `reviewDutyRequestAction`), a fresh insert reusing that same key
    value succeeds.
  - `/nobet-talepleri`, `/gecmis-nobetler`, and `/veri-kontrol` all
    return a clean `307` redirect to `/giris` (auth gate intact, no
    server error) when loaded unauthenticated against the real Postgres
    instance with the new schema applied.
