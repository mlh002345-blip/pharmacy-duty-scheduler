# Large-Data Volume & PostgreSQL Query-Plan Test

Step 5 of the pre-pilot infrastructure and security test plan. Populates
a dedicated PostgreSQL database with realistic pilot-scale synthetic
data, measures the application's critical read paths, inspects
PostgreSQL execution plans for the critical query inventory, and applies
only evidence-backed fixes.

## Environment safety model

- Dedicated database via `PERF_DATABASE_URL`, validated by
  `resolvePerfDatabaseUrl()` (`tests/integration/helpers/test-db-guard.ts`)
  — the same shared guard core used by `TEST_DATABASE_URL`,
  `RESTORE_DATABASE_URL`, and `E2E_DATABASE_URL`. Fails fast, before any
  migration, before any row is generated, unless **all** hold:
  1. `PERF_DATABASE_URL` is set explicitly — never falls back to
     `DATABASE_URL`, `TEST_DATABASE_URL`, `E2E_DATABASE_URL`, or
     `RESTORE_DATABASE_URL`.
  2. It's a valid `postgresql://`/`postgres://` URL.
  3. It doesn't resolve to the same host+port+database as `DATABASE_URL`
     (checked both as a byte-identical string and as a parsed
     protocol/host/port/path comparison).
  4. Its database name contains `perf`, `performance`, `benchmark`,
     `load`, `test`, `testing`, or `staging` (case-insensitive).
  5. Neither its hostname nor database name contains `prod`,
     `production`, or `live` — this check always wins even if a
     recognized marker is also present.
- Every `scripts/perf/*.ts` entry point calls `resolvePerfDatabaseUrl()`
  (via `scripts/perf/db.ts`'s `perfDatabaseUrl`/`perfPrisma`) before doing
  anything else — a bad `PERF_DATABASE_URL` stops the script before a
  single row is touched.
- `scripts/perf/seed-perf-data.ts` applies `prisma migrate deploy`
  against `PERF_DATABASE_URL` only (same command Railway production
  deploys use), never a destructive `migrate reset`.
- This suite **never** runs against Railway production and never falls
  back to a real developer's `DATABASE_URL`.

## Commands

| Command | What it does |
| --- | --- |
| `npm run test:perf:preflight` | Read-only: validates the guard, prints PG version/size/connection count. Applies nothing. |
| `npm run test:perf:seed -- --profile quick\|full` | Applies migrations, then generates synthetic data (default profile: `quick`). |
| `npm run test:perf:measure` | Builds and starts a real production server against `PERF_DATABASE_URL`, measures the critical page inventory. |
| `npm run test:perf:plans` | Runs `EXPLAIN (ANALYZE, BUFFERS, VERBOSE, FORMAT JSON)` for the critical query inventory (categories A–F). |
| `npm run test:perf:cleanup [runId]` | Deletes exactly the rows tracked by one benchmark run's manifest (defaults to the most recent). |

`npm test`, `npm run test:integration`, and `npm run test:e2e` are
unaffected — none of them import anything under `scripts/perf/`.

## Quick / full profiles

Defined in `scripts/perf/profiles.ts`. Both are deterministic (seeded
`mulberry32` PRNG, `scripts/perf/rng.ts` — same seed always produces the
same generated dataset shape).

| Model | Quick | Full |
| --- | --- | --- |
| Region | 5 | 50 |
| Pharmacy | 200 (40/region) | 5,000 (100/region) |
| HistoricalDutyRecord | 5,000 | 250,000 |
| AuditLog | 2,000 | 100,000 |
| DutyRequest | 1,000 | 50,000 |
| Unavailability | 500 | 20,000 |
| DutySchedule | 40 | 2,000 |
| DutyAssignment | ~295 (10 schedules get a full month) | ~6,000 (200 schedules get a full month) |
| DutyBalanceAdjustment | 300 | 5,000 |
| Session | 100 | 3,000 |
| LoginAttempt | 30 | 500 |
| User (ADMIN/STAFF/VIEWER pool) | 10 | 200 |

## Data-generation design

- **Batched, never a tight loop**: `scripts/perf/batch.ts`'s `chunk()`
  splits every large row set into ≤2,000-row `createMany` batches
  (`CREATE_MANY_BATCH_SIZE` in `seed-perf-data.ts`) with client-generated
  UUIDs, so child rows (e.g. `HistoricalDutyRecord.pharmacyId`) can
  reference a specific parent id without a round trip.
- **Manifest tracks only parent ids**: `scripts/perf/manifest.ts`'s
  `PerfManifest` records `regionIds`, `pharmacyIds`, `userIds`, and
  `historicalBatchIds` (plus `sessionTokenPrefix` and a small explicit
  `loginAttemptIds` list, since `Session.token` can be prefix-filtered
  but `LoginAttempt.bucketKey` is a one-way SHA-256 digest and cannot).
  Every other generated row (HistoricalDutyRecord, DutyAssignment,
  DutyRequest, Unavailability, DutyBalanceAdjustment, AuditLog) is
  deleted by `scripts/perf/cleanup.ts` filtering on these parent ids —
  never a table-wide wipe — so the manifest file's size stays independent
  of the total generated row count.
- **Benchmark-run marker**: every generated row's identifying text field
  (`Region.name`, `Pharmacy.name`, `User.email`, `Holiday.name`, …) is
  prefixed with `PERF-<runId>-`. `validateManifestForCleanup()`
  (`scripts/perf/manifest.ts`) refuses to run cleanup against a manifest
  that isn't marked this way, or that tracks zero parent ids.
- **Synthetic-only**: all names/emails/phones/tokens are generated,
  clearly marked, and never touch real pharmacist-chamber or Railway
  production data. Passwords use the real `hashPassword()` (scrypt), not
  a shortcut, so authenticated `measure.ts` requests exercise the actual
  session code path.

## Baseline application measurement

`scripts/perf/measure.ts` builds and starts a real **production** server
(`next build && next start`, matching the same technique used for Step
4's Playwright E2E suite) on `localhost:3211` with `DATABASE_URL`
overridden to `PERF_DATABASE_URL` for that child process only. It:

1. Creates one real, DB-backed session for a seeded `ADMIN` benchmark
   user (no login form — same technique as `tests/e2e/helpers/browser.ts`).
2. Warms up each target with 3 unmeasured requests, then measures 10
   more, computing `p50`/`p95`/`p99`/`min`/`max`/`mean`
   (`scripts/perf/percentile.ts`; `p99` is `null` below 20 samples — this
   suite always has too few for `p99` to be meaningful).
3. Records response status, error rate (`>=500`), response size, process
   RSS before/after, `pg_stat_activity` connection count before/after,
   and `pg_database_size` before/after.
4. Writes a JSON report under the gitignored `benchmark-output/`
   directory.

Targets measured: `/`, `/eczaneler`, `/mazeretler`, `/nobet-talepleri`,
`/gecmis-nobetler`, `/nobet-dengesi`, `/veri-kontrol`,
`/denetim-kayitlari`, `/cizelgeler`, one populated `/cizelgeler/[id]`,
its assignment-edit page, its Excel export, and its PDF export.

**Suggested local investigation thresholds** (not automatic pass/fail):
p95 page response > 1,500ms; p95 export > 5,000ms; any HTTP 500; memory
growth that doesn't stabilize; DB query duration > 500ms on the quick
profile; a sequential scan over a large, highly selective table.

**Known measurement limitation**: process RSS is read from
`serverProcess.pid`'s `/proc/<pid>/status`. Because `npm run start` is
launched through an intermediate `sh -c` / `npm` process tree, the pid
`measure.ts` holds does not always resolve to the actual Next.js server
process — the "after" RSS reading was `null` in this run's full-profile
measurement. RSS numbers from this script should be treated as
indicative at best; a future iteration should resolve the true listening
process's pid (e.g. via `pgrep -f "next-server"`) before trusting memory
deltas.

## EXPLAIN ANALYZE process

`scripts/perf/plans.ts` runs `EXPLAIN (ANALYZE, BUFFERS, VERBOSE, FORMAT
JSON)` for a curated set of SQL statements mirroring the actual
Prisma/SQL call sites behind categories A–F (see
`docs/security/23-large-data-query-plan-validation.md` for the full
inventory and file:line references), using real ids sampled from the
most recent manifest. `scripts/perf/plan-parser.ts` is a pure module
(no I/O) that extracts scan types, actual-vs-estimated row counts, rows
removed by filter, buffer hit/read counts, and disk-spilled sorts from
the JSON plan — directly unit-tested (`plan-parser.test.ts`) without a
database. `isConcerningSequentialScan()` flags a sequential scan only
when the underlying scan touched ≥10,000 rows **and** returned fewer
than 20% of them — a seq scan over a small table, or one that returns
most of what it scanned, isn't a signal an index would help.

Output: a machine-readable JSON file and a concise markdown summary,
both under the gitignored `benchmark-output/` directory (per-run
markdown summaries worth keeping long-term are copied into
`docs/security/23-large-data-query-plan-validation.md` instead of being
committed as raw artifacts).

## Cleanup procedure

`npm run test:perf:cleanup [runId]` (defaults to the most recently
written manifest via `findLatestManifest()`):

1. Re-validates the guard (`resolvePerfDatabaseUrl()`).
2. Validates the manifest itself (`validateManifestForCleanup()`) —
   refuses to proceed against a manifest missing a `PERF-` marker or
   tracking zero parent ids.
3. Deletes in FK-safe order (children before parents): `AuditLog` →
   `DutyBalanceAdjustment` → `Unavailability` → `DutyRequest` →
   `HistoricalDutyRecord` → `HistoricalDutyImportBatch` →
   `DutyScheduleWarning` → `DutyAssignment` → `DutySchedule` →
   `DutyRule` → `Pharmacy` → `Session` → `LoginAttempt` → `User` →
   `Holiday` → `Region` — every delete scoped to this run's own tracked
   ids (`{ id: { in: [...] } }` or `{ regionId: { in: regionIds } }` /
   `{ pharmacyId: { in: pharmacyIds } }` etc.), never an unscoped
   `deleteMany({})`.

Verified end-to-end against the local quick-profile run: every table's
deleted row count matched its seeded count exactly (Region 5, Pharmacy
200, HistoricalDutyRecord 5,000, AuditLog 2,000, DutyRequest 1,000,
Unavailability 500, DutySchedule 40, DutyAssignment 295,
DutyBalanceAdjustment 300, Session 100, LoginAttempt 30, User 10, Holiday
21, HistoricalDutyImportBatch 1).

## Local vs. Railway limitations

- Timings in this document were measured on this session's local
  sandbox (PostgreSQL 16.13 on the same host as the Next.js process, no
  network hop). Railway's production topology (separate app/DB hosts,
  real network latency, different CPU/memory allocation, connection
  pooler behavior) will produce different absolute numbers — the
  *relative* findings (which endpoints are slow, why, and whether an
  index/aggregation helps) should still transfer, but the specific
  millisecond thresholds should be re-validated against a live/staging
  Railway environment before being treated as SLOs.
- `pg_stat_activity`/`pg_database_size`/index-size figures reflect this
  session's single-connection, single-process benchmark run, not
  concurrent multi-user production load.

## Interpretation guidance

- A sub-1ms `EXPLAIN ANALYZE` execution time with an index scan is
  strong evidence a query shape is fine at the tested scale — do not
  "improve" it further.
- A sequential scan alone is not a defect; only a sequential scan over a
  large table with a highly selective predicate ("scanned everything,
  kept < 20%") is worth investigating, and even then only if it sits on
  a frequently-hit path.
- A slow *page* with fast underlying *queries* points at rendering or
  serialization cost, not the database — see the `/nobet-dengesi` /
  `/gecmis-nobetler` finding in
  `docs/security/23-large-data-query-plan-validation.md`, where the
  query dropped to ~47ms but the page itself stayed multi-second because
  it renders one table row per pharmacy with no pagination.
