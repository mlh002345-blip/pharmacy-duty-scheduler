# PostgreSQL Failure, Latency & Connection-Pool Resilience (Chaos) Test

Step 6 of the pre-pilot infrastructure and security test plan. Proves
that the application fails safely, preserves transactional consistency,
emits diagnosable logs, and recovers after PostgreSQL latency,
disconnection, restart, lock contention, and connection-pool pressure —
against a real local PostgreSQL instance, never mocked.

## Prerequisites

- A local PostgreSQL 16 service the calling process can `service
  postgresql stop|start` and connect to as a superuser role (this
  session used role `app`, already superuser in the local sandbox).
- A dedicated chaos database (e.g. `pharmacy_duty_scheduler_chaos`),
  distinct from every other guarded database (`DATABASE_URL`,
  `TEST_DATABASE_URL`, `E2E_DATABASE_URL`, `PERF_DATABASE_URL`,
  `RESTORE_DATABASE_URL`).
- `CHAOS_DATABASE_URL` set to that database's connection string.

## Safe environment model

- `resolveChaosDatabaseUrl()` (`tests/integration/helpers/test-db-guard.ts`)
  — the same shared guard core as every other dedicated-database
  command in this repo. Fails fast, before any migration, fault
  injection, or cleanup, unless **all** hold:
  1. `CHAOS_DATABASE_URL` is set explicitly — no fallback to
     `DATABASE_URL` or any other guarded URL.
  2. It's a valid `postgresql://`/`postgres://` URL.
  3. It doesn't resolve to the same host+port+database as `DATABASE_URL`.
  4. Its database name contains `chaos`, `resilience`, `failure`,
     `fault`, `test`, `testing`, or `staging`.
  5. Neither its hostname nor database name contains `prod`,
     `production`, or `live` — always wins even alongside a valid
     marker.
- `scripts/chaos/fault-control.ts`'s every destructive function
  re-validates its target database name against the same marker
  pattern (`validateFaultTarget()`, pure and independently unit-tested)
  before acting — a fault-injection call can never silently drift onto
  a different database name.
- **This suite never touches Railway production** — no code path here
  reads `DATABASE_URL` for a connection; every chaos Prisma client is
  constructed with `datasourceUrl: resolveChaosDatabaseUrl()`'s output
  only (`scripts/chaos/db.ts`, `tests/chaos/helpers/db.ts`).
- Cleanup (`npm run test:chaos:cleanup`) is manifest-based, mirroring
  `scripts/perf/`'s design: every fixture-creating helper
  (`tests/chaos/helpers/fixtures.ts`) tags its rows with a
  `CHAOS-<runId>-` marker and incrementally writes its parent ids
  (region/pharmacy/user/historical-batch) to a per-run manifest file
  under the gitignored `chaos-output/` directory — updated in real time,
  not just at the end, so a crashed run (e.g. the process died mid-fault-
  injection) still leaves an accurate manifest to clean up later.
  `validateManifestForCleanup()` refuses to run against a manifest
  missing a `CHAOS-` marker or tracking zero parent ids.

## Supported fault-injection mechanisms

Toxiproxy (or an equivalent TCP proxy) was considered first, per the
task's own preference — this sandbox has `docker` installed but its
daemon is not reachable (`/var/run/docker.sock` doesn't exist), and no
`toxiproxy-server`/`toxiproxy-cli` binary is present. **Local PostgreSQL
controls (option B) were used instead**, all scoped to the guarded chaos
target:

| Mechanism | Function | Scope |
| --- | --- | --- |
| Terminate one specific backend | `terminateBackendPid(pid)` | Exactly one connection, identified via `SELECT pg_backend_pid()` from inside the real transaction being tested |
| Terminate all chaos-DB backends | `terminateBackendsForChaosDatabase()` | Only sessions where `datname = <chaos db>` |
| Stop/start the local PostgreSQL service | `stopLocalPostgresService()` / `startLocalPostgresService()` | The single local PostgreSQL cluster in this sandbox (hosts every dedicated test database — there is no per-database stop/start primitive in PostgreSQL itself, so this is the closest local equivalent to "restart the dedicated service") |
| Connection-limit pressure | `connection_limit`/`pool_timeout` query params on a dedicated `PrismaClient`'s URL | Only that client's own pool — the real Prisma-supported mechanism, not a fork/monkey-patch |
| Scoped lock timeout | `SET LOCAL lock_timeout = '...'` inside a transaction | Only that one transaction |
| Advisory/row lock holding | A real `$transaction` callback gated on a `Promise` (deterministic, not a sleep) | Only the two connections under test |

No production PostgreSQL configuration was touched; no unrelated local
session was killed; no arbitrary broad process-kill command was used.

## Commands

| Command | What it does |
| --- | --- |
| `npm run test:chaos:preflight` | Read-only: validates the guard, prints PG version, connection count, `max_connections`. Injects nothing. |
| `npm run test:chaos` | Runs the full chaos suite (`vitest.chaos.config.ts`) — builds the app once (global setup), applies migrations, then runs every scenario file sequentially (`fileParallelism: false`, since scenarios share the one local PostgreSQL service). |
| `npm run test:chaos:cleanup [runId]` | Deletes exactly the rows tracked by one run's manifest (or every manifest found, if no `runId` given). |

`npm test`, `npm run test:integration`, `npm run test:e2e`, and `npm run
test:perf:*` are unaffected — `vitest.config.ts` explicitly excludes
`tests/chaos/**`.

## Test architecture

- `tests/chaos/helpers/db.ts` / `scripts/chaos/db.ts` — guard-validated
  `chaosPrisma` clients (two separate files/instances, one for each
  side of the codebase that needs one; both resolve the identical URL).
- `tests/chaos/helpers/setup.ts` — per-worker setup, mirroring
  `tests/integration/helpers/setup.ts`: mocks `next/headers`/
  `next/navigation`/`next/cache` so real Server Actions
  (`loginAction`, `logoutAction`, `generateAndSaveDutySchedule`) can be
  called directly, and points the app's own `@/lib/prisma` singleton at
  the chaos database *before* any of that code is imported — done by
  importing (not re-resolving) the already-guard-validated URL to avoid
  a self-equality false-positive against the guard (documented in the
  file itself).
- `tests/chaos/helpers/server.ts` — starts/stops a real **production**
  server (`next start`, against a build produced once in global setup)
  for the scenarios that need to observe genuine framework-level error
  handling (no stack trace/SQL/connection string reaching an HTTP
  response) — spawned with `detached: true` so `stopChaosServer()` can
  kill the *entire* process group (`next start`'s actual `next-server`
  child was observed to survive a plain `SIGTERM` to the wrapper
  process otherwise).
- `tests/chaos/helpers/wait-until.ts` — bounded polling gate
  (`waitUntil(check, { timeoutMs, description })`), the only
  synchronization primitive used for "wait for X to become true" —
  never a blind `sleep(N)`.
- `tests/chaos/helpers/fixtures.ts` — real, manifest-tracked
  region/pharmacy/user/session/schedule creation against the chaos
  database.
- `instrumentation.ts` (repo root) — new in this step; see
  "Observability" below.

## Scenarios and expected failure/recovery behavior

**A — DB unavailable during read** (`01-read-outage.chaos.test.ts`):
stops the local PostgreSQL service, hits `/giris`, `/`, `/veri-kontrol`,
`/nobet-dengesi`, `/nobet-talepleri` on a real running production
server. Asserts: bounded response time (never a hang), a controlled
status (200/302/303/500, never left open), no raw SQL/connection
string/stack trace in the body, the server process stays alive, a
`database_read_failed` structured log line is emitted with a
`requestId` and a Prisma error code, and once PostgreSQL is restarted
the *same, never-restarted* server process serves a successful request
again.

**B — DB disconnect mid multi-write transaction**
(`02-transaction-rollback.chaos.test.ts`): calls the real
`generateAndSaveDutySchedule` (the function `createDutyScheduleAction`
itself calls), using its existing, documented test-only
`writeAuditLogFn` seam to capture the transaction's own backend pid
(`SELECT pg_backend_pid()`) and terminate *that exact connection* after
the `DutySchedule`/`DutyAssignment` rows have been written but before
commit. Asserts real PostgreSQL rollback: zero `DutySchedule`, zero
`DutyAssignment`, zero `DutyScheduleWarning`, zero matching `AuditLog`
rows survive, and the caller receives a failure, never success.

**C — DB restart and recovery** (`03-restart-recovery.chaos.test.ts`):
stops/starts the *entire* local PostgreSQL service (not just one
backend). Confirms reads and writes both fail in a bounded, controlled
way during the outage and the process survives; confirms an
idempotent-safe write (`logoutAction`, whose underlying `deleteMany` is
a no-op on an already-gone row) can be manually retried with no error
and no duplicate effect; confirms a non-idempotent write
(`generateAndSaveDutySchedule`) is attempted **exactly once** (a call
counter patched onto the app's own `prisma.region.findUnique`) when the
database is down — the app has no retry wrapper anywhere in its write
paths — and leaves zero partial rows.

**D — connection-pool pressure** (`04-pool-pressure.chaos.test.ts`): a
dedicated `PrismaClient` with `connection_limit=5&pool_timeout=5`
against the real chaos database, driven with 10/25/50 concurrent reads,
a mixed read/write workload, and a final leak check
(`pg_stat_activity` count returns to baseline after the pressured
client disconnects).

**E — lock contention** (`05-lock-contention.chaos.test.ts`): two real,
concurrent transactions — one holds `pg_advisory_xact_lock` (the real
`assertLastActiveAdminNotRemoved` last-active-admin guard) or a real row
`UPDATE`, gated open on a `Promise` (deterministic barrier, not a
sleep); the second uses a transaction-scoped `SET LOCAL lock_timeout`
and is asserted to fail in a bounded time (never indefinite), with no
partial commit, and a fresh attempt succeeds once the holder releases.

**F — data-health cache failure/recovery**
(`06-data-health-cache.chaos.test.ts`): uses `getDataHealthReport`'s own
existing `{ now }` test seam (no need to wait 60 real seconds) to force
a refresh attempt past the 60s TTL while PostgreSQL is down. Asserts
`data_health_report_failed` is logged, the failed refresh does not
poison the cache with invalid data, and a subsequent refresh after
PostgreSQL recovers returns a valid, well-formed report.

**Login/rate-limiter outage** (`07-login-rate-limiter-outage.chaos.test.ts`):
exercises the real, unmodified `loginAction` at three points — before
the rate-limit check, after credential verification but before session
creation (a patched `prisma.session.create` seam triggers the outage
at exactly that instant), and during failed-attempt recording (a
patched `prisma.$queryRaw` seam). See "Login/rate-limiter policy" in
`docs/security/24-db-resilience-connection-pool-validation.md` for the
observed, documented policy.

## Metrics captured

Response/attempt duration (`performance.now()` deltas), success/error
counts, `pg_stat_activity` connection counts (before/during/after),
`pg_database_size`, process RSS (`process.memoryUsage().rss`),
first-successful-request-after-recovery time (via `waitUntil`'s return
value), and — for scenario D — the same `computeDurationStats()`
percentile helper built for Step 5's performance suite
(`scripts/perf/percentile.ts`, reused directly rather than duplicated).

## Cleanup

`npm run test:chaos:cleanup [runId]`: validates the guard, validates
the manifest (`validateManifestForCleanup()` — refuses an unmarked
manifest or one with zero tracked parent ids), then deletes in FK-safe
order (`AuditLog` → `DutyBalanceAdjustment` → `Unavailability` →
`DutyRequest` → `HistoricalDutyRecord` → `HistoricalDutyImportBatch` →
`DutyScheduleWarning` → `DutyAssignment` → `DutySchedule` → `DutyRule`
→ `Pharmacy` → `Session` → `User` → `Region`), scoped strictly to that
run's tracked ids — never an unscoped `deleteMany({})`. With no
`runId` argument, every manifest found under `chaos-output/` is cleaned
up (covers a scenario that crashed before its own `afterAll` ran).

## Emergency stop

If a chaos run is interrupted mid-fault-injection (PostgreSQL stopped,
process killed):

1. `service postgresql start` (or `startLocalPostgresService()` via
   `npx tsx -e "..."`) — restores the local service.
2. `npm run test:chaos:cleanup` — removes any leftover marked rows from
   every manifest on disk.
3. Verify with `npm run test:chaos:preflight`.

Every scenario file's `afterAll` already performs step 1 defensively
(checks whether PostgreSQL is up, restarts it if not) before tearing
down its own server process — this is a backup path for a harder crash
(e.g. the Vitest process itself being killed).

## Limitations relative to Railway production

- This suite restarts a **single local PostgreSQL service** shared by
  every dedicated test database in this sandbox — Railway's managed
  PostgreSQL has its own restart/failover behavior (potentially a
  different host entirely, with its own connection-draining and
  DNS/proxy layer) that this suite cannot exercise.
  Connection-pool-recovery *timing* in particular (~12.5s observed
  locally after a full service restart vs. near-instant after a single
  backend termination — see `docs/security/24-*.md`) is specific to
  this sandbox's PostgreSQL version/config and should not be treated as
  a Railway SLO.
- Toxiproxy-style network-level fault injection (asymmetric latency,
  partial packet loss, a slow-but-not-dead connection) was not
  available in this sandbox and was not exercised — only "connection
  works" / "connection refused/reset" / "full service down" were
  tested, not intermediate degraded-network conditions.
- No multi-instance/horizontal-scaling scenario was tested — this app
  has no code path assuming more than one running instance today, and
  the pilot's expected topology is single-instance.
- Excel resource-exhaustion testing, TLS testing, and dependency
  advisory scanning are explicitly out of scope for this step (per the
  task) and belong to future steps.
