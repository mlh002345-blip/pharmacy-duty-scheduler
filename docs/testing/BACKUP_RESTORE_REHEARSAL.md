# PostgreSQL Backup–Restore Rehearsal

Step 3 of the pre-pilot infrastructure and security test plan. Proves
that a real logical backup of the (Railway) production database can be
restored into a separate, dedicated database and that the result is
usable and internally consistent — without ever writing to the source
and without ever restoring into production.

## Prerequisites

- `pg_dump`/`pg_restore`/`psql` available on the machine running the
  rehearsal (already present in this repo's dev/CI environment; matching
  major version to the target PostgreSQL server is recommended but not
  required for a logical custom-format dump/restore between compatible
  versions).
- Node.js + this repo's `npm ci`-installed dependencies (`tsx`,
  `@prisma/client`) — no new dependency was added for this step.
- Read access to the real Railway production `DATABASE_URL` (for a real
  rehearsal — see "What this repo cannot verify" below for what that
  actually requires from Railway's side).
- A **separate, dedicated** PostgreSQL database to restore into —
  never the production database, never the app's normal
  `TEST_DATABASE_URL` used by `npm run test:integration` (that database
  is destructively reset by every integration-test run and should not
  double as a restore target).

## Required environment variables

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | The backup **source** — read-only for this entire procedure. In a real rehearsal, the actual Railway production connection string. |
| `RESTORE_DATABASE_URL` | The dedicated restore **target** — validated by `resolveRestoreDatabaseUrl()` (`tests/integration/helpers/test-db-guard.ts`) before any destructive operation. |
| `CONFIRM_PRODUCTION_BACKUP=true` | Required by `db:backup:production` (and by the combined rehearsal) — a deliberate-action guard confirming you intend to open a read-only connection to `DATABASE_URL` and dump it. |
| `CONFIRM_BACKUP_RESTORE_REHEARSAL=true` | Required by `db:recovery:rehearsal` — confirms the combined backup→restore→verify run is intentional. |
| `BACKUP_FILE` | Optional for `db:restore:test` — path to a specific `.dump` file. If omitted, the most recent `.dump` under `backups/` is used. |

## Safety model

All of this reuses and extends the same guard already used by
`npm run test:integration`/`npm run test:preflight`
(`tests/integration/helpers/test-db-guard.ts`), now exported as two
functions from one shared module:

- `resolveTestDatabaseUrl()` — unchanged, used by the integration suite.
- `resolveRestoreDatabaseUrl()` — new, used by every script in
  `scripts/backup-restore/`. Fails fast (throws, refuses to run) unless
  **all** of the following hold:
  1. `RESTORE_DATABASE_URL` is set explicitly — no fallback to
     `DATABASE_URL`, ever.
  2. It is a valid, parseable `postgresql://`/`postgres://` URL.
  3. It is not byte-identical to `DATABASE_URL`, and does not resolve to
     the same protocol+host+port+database path as `DATABASE_URL` even
     with different credentials/query parameters.
  4. Its database name contains one of: `test`, `testing`,
     `integration`, `restore`, `staging`, `recovery` (case-insensitive).
  5. Neither its hostname nor its database name contains `prod`,
     `production`, or `live` — evaluated even when a recognized marker
     is also present, and this check always wins.

This guard runs **before any destructive operation** in every script —
`restore-backup-to-test.ts` calls it as the very first statement, before
even resolving which backup file to use, and `recovery-rehearsal.ts`
calls it before even starting the backup step.

**Source-side operations are read-only everywhere**: `pg_dump` never
writes to its source by design; the verification script
(`verify-restored-db.ts`) only ever issues `SELECT`/`COUNT`/read-only
`pg_indexes`/`_prisma_migrations` queries against `DATABASE_URL`. No
script in `scripts/backup-restore/` ever issues a write, `DROP`,
`TRUNCATE`, or migration command against `DATABASE_URL` — every
destructive statement (`DROP SCHEMA public CASCADE`, `pg_restore`) is
scoped exclusively to `RESTORE_DATABASE_URL`, which the guard has
already validated is not production.

**Credentials are never printed.** `pg_dump`/`pg_restore`/`psql` receive
the password via the `PGPASSWORD` environment variable
(`scripts/backup-restore/pg-connection.ts`), not as part of a command-
line argument (which would be briefly visible to other processes via
`ps`). Every log line prints only `sanitizedDatabaseIdentifier()` —
`host:port/database`, never the username, password, or query string.

## Backup storage and checksum procedure

- Backups are written to `backups/` at the repo root, which is
  **gitignored** (`/backups/` added to `.gitignore` in this same
  change) — no dump file, checksum, manifest, or rehearsal report is
  ever committed.
- Filename: `<sanitized-db-name>_<ISO-timestamp-with-dashes>.dump`
  (custom format, per `pg_dump --format=custom`).
- A `.sha256` file is written alongside it in standard `sha256sum`
  format (`<hex-digest>  <filename>`), computed by streaming the file
  (never loading a large dump fully into memory just to checksum it).
- A `.manifest.json` file is written alongside it recording:
  `sourceIdentifier` (sanitized), `dumpStartedAt`, `dumpFinishedAt`,
  `postgresVersion` (from `SELECT version()` against the source, itself
  not a secret), `format`, `fileSizeBytes`, and `sha256` — no
  credentials, no data.

## Exact commands

### Individual steps

```bash
# 1. Backup (source = DATABASE_URL, read-only)
export DATABASE_URL="postgresql://user:pass@<railway-host>:5432/<db>"
CONFIRM_PRODUCTION_BACKUP=true npm run db:backup:production

# 2. Restore (target = RESTORE_DATABASE_URL, dedicated, guard-checked)
export RESTORE_DATABASE_URL="postgresql://user:pass@<restore-host>:5432/pharmacy_duty_scheduler_restore"
BACKUP_FILE=backups/<file-from-step-1>.dump npm run db:restore:test
# (BACKUP_FILE may be omitted — the most recent backups/*.dump is used)

# 3. Verify (read-only against both DATABASE_URL and RESTORE_DATABASE_URL)
npm run db:verify:restore
```

### Combined rehearsal (all three steps, with timing/RTO/RPO report)

```bash
export DATABASE_URL="postgresql://user:pass@<railway-host>:5432/<db>"
export RESTORE_DATABASE_URL="postgresql://user:pass@<restore-host>:5432/pharmacy_duty_scheduler_restore"
CONFIRM_BACKUP_RESTORE_REHEARSAL=true CONFIRM_PRODUCTION_BACKUP=true \
  npm run db:recovery:rehearsal
```

Stops immediately (non-zero exit) on any failed guard or any failed
child command — each step is invoked via `execFileSync`, which throws on
a non-zero exit code, so there is no "continue after a failed step"
path.

## Source and target naming rules

- **Source** (`DATABASE_URL`): whatever the real production connection
  string is — this repo does not impose a naming rule on it, since it
  cannot control Railway's naming.
- **Target** (`RESTORE_DATABASE_URL`): must be a dedicated database whose
  name contains `test`, `testing`, `integration`, `restore`, `staging`,
  or `recovery`, and must not contain `prod`, `production`, or `live`
  anywhere in its hostname or database name. Recommended:
  `pharmacy_duty_scheduler_restore`.
- The target must **never** be the same database (by host+port+path,
  not just by string) as `DATABASE_URL`, `TEST_DATABASE_URL` (used
  destructively by `npm run test:integration`), or any real demo/staging
  database actively serving traffic.

## Restore steps (what `db:restore:test` actually does)

1. `resolveRestoreDatabaseUrl()` — guard, fails before anything else if
   unsafe.
2. `DROP SCHEMA IF EXISTS "public" CASCADE; CREATE SCHEMA "public";` —
   run only against `RESTORE_DATABASE_URL`, making the target an empty
   shell ready for a clean restore (equivalent to "recreate the target,"
   without the extra risk of a full `DROP DATABASE`/`CREATE DATABASE`
   cycle, which would require connecting to a separate maintenance
   database and is unnecessary when only the `public` schema needs to be
   reset).
3. `pg_restore --no-owner --no-privileges` — restores the dump file into
   `RESTORE_DATABASE_URL`.
4. `npx prisma migrate status` against `RESTORE_DATABASE_URL` —
   informational only; never applies a migration (the restored dump
   already contains whatever `_prisma_migrations` history the source had
   at dump time).
5. **No seed is ever run.** `db:restore:test` never invokes
   `prisma/seed.ts`.

## Data-integrity verification checks (`db:verify:restore`)

All read-only, against both `DATABASE_URL` (source) and
`RESTORE_DATABASE_URL` (target):

- **Row counts** for every table: `User`, `Session`, `Region`,
  `Pharmacy`, `DutyRule`, `Holiday`, `Unavailability`, `DutySchedule`,
  `DutyAssignment`, `DutyScheduleWarning`, `DutyRequest`,
  `HistoricalDutyImportBatch`, `HistoricalDutyRecord`,
  `DutyBalanceAdjustment`, `AuditLog`, `LoginAttempt`.
- **Foreign-key integrity** on the restored database: `DutyAssignment →
  DutySchedule`, `DutyAssignment → Pharmacy`, `DutyRequest → Pharmacy`,
  `HistoricalDutyRecord → Pharmacy` (matched rows only),
  `DutyScheduleWarning → DutySchedule`, `Session → User` — each checked
  via a `LEFT JOIN ... WHERE <parent>.id IS NULL` orphan count.
- **Unique constraints present** on the restored database: presence of
  `User_email_key`, `Session_token_key`, `Region_name_key`,
  `Pharmacy_requestToken_key`, `DutyRequest_dedupKey_key`,
  `HistoricalDutyImportBatch_fingerprint_key`,
  `LoginAttempt_bucketType_bucketKey_key` via `pg_indexes`.
- **Migration history**: `_prisma_migrations` migration names compared,
  source vs. restored.
- **Non-secret aggregate checksums**: a SHA-256 over the sorted,
  non-secret columns of `Region(name,district)`,
  `Pharmacy(name,city,district,isActive)`,
  `DutySchedule(year,month,regionId,status)`, and
  `User(email,role,isActive)` — compared source vs. restored. **Never**
  selects or hashes `passwordHash`, `Session.token`,
  `Pharmacy.requestToken`, or any other secret/token column.

The script prints a per-check `OK`/`MISMATCH` line and exits non-zero if
anything doesn't match, with a final summary listing every mismatch.

## Smoke-test steps

Temporarily point the running app at `RESTORE_DATABASE_URL` (never at
the same time as pointing anything at `DATABASE_URL` for a write) and
confirm:

1. `/giris` returns `200`.
2. `/veri-kontrol`, `/nobet-talepleri`, `/gecmis-nobetler`,
   `/nobet-dengesi`, and the three export routes
   (`/cizelgeler/[id]/export/excel`, `/cizelgeler/[id]/export/pdf`,
   `/gecmis-nobetler/sablon`) all return a clean `307` redirect to
   `/giris` when unauthenticated — proving each route compiles and
   successfully executes its `getCurrentUser()`/data-fetch call against
   the restored schema (a schema mismatch or missing table would surface
   as a `500`, not a clean redirect).
3. If exercising an authenticated flow: log in with a real account
   already present in the restored data (its `passwordHash` was copied
   byte-for-byte by `pg_dump`/`pg_restore`, so the same password that
   worked against the source works identically against the restore) and
   confirm the dashboard, `/veri-kontrol`, `/nobet-talepleri`,
   `/gecmis-nobetler`, and `/nobet-dengesi` render real data, and that a
   read-only Excel/PDF export downloads successfully.
4. **Do not perform destructive writes against the restored database**
   beyond what's needed to prove the smoke test (e.g. do not run the
   demo seed against it) unless explicitly isolated there and cleaned up
   afterward — the restored database is disposable, but treat it with
   the same care as any other database you don't want silently polluted
   between rehearsals.
5. Stop the temporarily-pointed app process when done.

## RPO and RTO definitions

- **RTO (Recovery Time Objective)** for this rehearsal: measured as
  restore-start → verification-end (the time from "we have a backup
  file and start restoring" to "we've proven the restore is correct").
  `db:recovery:rehearsal` measures and prints this automatically, and
  writes it to `backups/rehearsal-report_<timestamp>.json` (gitignored).
- **RPO (Recovery Point Objective)**: this procedure produces a
  **logical dump point-in-time only** — a snapshot as of the moment
  `pg_dump` ran. Any write to the source between the dump's start and
  a real incident is **not** captured by this backup. This tooling
  provides **no continuous or point-in-time-recovery (PITR) guarantee**
  on its own. If Railway's own managed PostgreSQL backup feature
  provides continuous/PITR backups, that would improve RPO beyond what
  this logical-dump rehearsal alone can offer — see "What Railway could
  additionally provide" below.

## Emergency stop procedure

If at any point during a rehearsal you suspect the wrong database is
being targeted (in particular, if `RESTORE_DATABASE_URL` might actually
be pointing at a database with real data you care about):

1. **Interrupt immediately** (`Ctrl+C` / kill the running script). Every
   step here is a single foreground process.
2. **Check what actually ran.** The guard
   (`resolveRestoreDatabaseUrl()`) runs before any destructive step in
   every script — if it threw, nothing was touched. If the restore step
   had already started, the destructive action is scoped to exactly the
   `public` schema of `RESTORE_DATABASE_URL` (never the whole database,
   never `DATABASE_URL`) — check the printed `Restore target
   (sanitized): host:port/database` line in the script's own output
   against what you actually intended.
3. **Never re-run with the same environment blindly** — `unset
   RESTORE_DATABASE_URL` (and `DATABASE_URL` if that's what was
   misconfigured) and re-derive the correct value from your actual
   provisioning record.
4. If a real, needed database's `public` schema was genuinely dropped by
   mistake (i.e., `RESTORE_DATABASE_URL` was pointed at something that
   turned out to matter), restore it from **that database's own**
   backup/snapshot — this is exactly the scenario this rehearsal
   tooling exists to safely rehearse against a disposable target, so
   losing a disposable restore-target database's contents is expected
   and low-cost; losing anything else means the guard was bypassed or
   misconfigured and should be treated as a real incident.
5. Fix the root cause (which environment variable held the wrong value
   and why) before running any backup/restore command again.

## What Railway dashboard backups/PITR could additionally provide (not verifiable from this repo)

- Whether Railway's managed PostgreSQL offering includes automatic
  scheduled backups, and at what retention/frequency — this is a
  dashboard/plan-tier setting, not something in this repository.
- Whether Railway offers continuous/point-in-time recovery (PITR) with
  an RPO measured in seconds rather than "since the last logical dump
  this repo's tooling happened to run" — if so, that capability exists
  independently of (and likely superior to) this repository's own
  `pg_dump`-based rehearsal tooling for actual disaster recovery, and
  should be the primary recovery mechanism in a real incident; this
  rehearsal tooling's value is proving the *logical* backup/restore path
  works and is exercised at least once, as a fallback and as a way to
  produce a portable, inspectable dump independent of Railway's own
  backup storage.
- Cross-region/provider durability of Railway's own backup storage.
- None of the above can be confirmed or denied from this codebase —
  consistent with every other "Not inspectable from this repo" Railway
  finding in `docs/security/14-configuration-environment-hardening.md`,
  `docs/security/15-dependency-supply-chain-review.md`, and
  `docs/security/20-verification-false-positive-filter.md`.
