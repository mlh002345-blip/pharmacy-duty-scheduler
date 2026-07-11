# DB Resilience & Connection-Pool Validation

Date: 2026-07-11, branch `deploy/postgresql-demo`. Pre-pilot test plan,
Step 6.

## Scope

Proved that the application fails safely, preserves transactional
consistency, emits diagnosable logs, and recovers after PostgreSQL
latency, disconnection, restart, lock contention, and connection-pool
pressure — against a real, dedicated local PostgreSQL database, using
only local PostgreSQL fault-injection controls (Toxiproxy was
unavailable in this sandbox — no working Docker daemon, no
`toxiproxy-server` binary; see `docs/testing/DB_RESILIENCE_CHAOS_TEST.md`).
Full architecture, safety model, and commands are in that document.

## Actual connection configuration (inspected, not assumed)

- **Prisma version**: `prisma` and `@prisma/client` both `6.19.3`
  (`npx prisma -v`), Node-API query engine, Node.js v22.22.2.
- **Client construction** (`src/lib/prisma.ts`): a single lazily-created
  global singleton, `new PrismaClient(env.databaseUrl ? {
  datasourceUrl: env.databaseUrl } : undefined)`. `env.databaseUrl`
  (`src/lib/env.ts`) is validated at process startup (throws before the
  client is ever constructed if `DATABASE_URL` is missing, or if it's a
  non-PostgreSQL URL in production) but is otherwise passed through
  unmodified — **no `connection_limit`, `pool_timeout`,
  `connect_timeout`, or `statement_timeout` query parameter is ever
  added by application code.** Whatever pool/timeout behavior exists is
  either PostgreSQL's own defaults or Prisma's own defaults for an
  unparameterized URL.
- **Default connection pool size**: empirically measured (not merely
  cited from documentation) by driving 60 concurrent raw queries through
  the default (no `connection_limit` parameter) chaos Prisma client and
  polling `pg_stat_activity` — **maximum observed concurrent connections
  was 9**, in a 4-CPU-core sandbox. This exactly matches Prisma's
  documented default formula (`num_physical_cpus * 2 + 1` = `4*2+1 = 9`)
  for this Prisma version, confirming the app is running with that
  default rather than some other inherited value.
- **`connect_timeout`/`pool_timeout`/`statement_timeout`/transaction
  timeout**: none are set by the app; PostgreSQL/Prisma defaults apply
  (`pool_timeout` defaults to 10s per Prisma's documentation for this
  version; not independently re-derived here since scenario D's tests
  set their own explicit `pool_timeout` for determinism rather than
  relying on the unstated default).
- **Retry wrapper**: none exists anywhere in the codebase. `grep`-level
  inspection of every `$transaction` call site
  (`src/app/**/actions.ts`, `src/lib/scheduling/generate-and-save-duty-schedule.ts`)
  and of `src/lib/auth/login-rate-limit.ts` found no retry
  library import, no hand-rolled retry loop, and no `setTimeout`-based
  backoff anywhere in a database call path. Confirmed empirically in
  scenario C (§ below): a non-idempotent write issues **exactly one**
  attempt when the database is unreachable.
- **Existing controlled-error/logging paths found before this step**:
  `src/lib/observability/logger.ts` (structured, redacting
  `password|token|cookie|authorization|secret|database.?url` context
  keys, and — see the fix below — now also connection-string-shaped
  substrings inside error *messages*), used already for login-failure/
  rate-limit/data-health-cache-refresh-failure events. No equivalent
  logging existed for a bare read failure during Server Component
  rendering — see the `instrumentation.ts` fix below.
- **Railway-specific behavior that cannot be inspected from this repo**:
  connection draining during a Railway-managed PostgreSQL restart/
  failover, any PgBouncer/connection-pooler Railway may place in front
  of the database, real network latency and partial-failure modes
  between the app and DB hosts, and Railway's own process-restart
  policy on an unhandled crash. None of these are testable from a local
  sandbox and are flagged as residual risk below.

## Fault-injection architecture used

Local PostgreSQL controls only (`scripts/chaos/fault-control.ts`):
single-backend termination (`SELECT pg_backend_pid()` from inside the
real transaction under test, then `pg_terminate_backend` from a
separate admin connection), full local-service stop/start
(`service postgresql stop|start`), `connection_limit`/`pool_timeout`
query parameters on a dedicated `PrismaClient`, and transaction-scoped
`SET LOCAL lock_timeout`. All destructive actions re-validate their
target database name against the guard's marker pattern before acting.
No production PostgreSQL configuration was touched; no session outside
the guarded chaos database was ever terminated.

## Scenario results

### A — DB unavailable during reads

Real production server, real HTTP requests, local PostgreSQL service
stopped. Every one of `/giris`, `/`, `/veri-kontrol`, `/nobet-dengesi`,
`/nobet-talepleri` returned within bounds (well under the 15s test
timeout; actual failures returned in well under 1s), with a controlled
status (200 for the always-static-shell login page's outer chrome, 500
for DB-dependent pages), never a raw stack trace, SQL fragment,
connection string, or `ECONNREFUSED`/Prisma error code string in the
response body. The server process never crashed. After PostgreSQL was
restarted, **the same, never-restarted server process** served a
successful request again — Prisma's connection pool self-heals without
an application restart.

**Real defect found and fixed**: the failure above was *safe* but was
never logged anywhere — no operator-visible record existed of a failed
page render due to a DB outage. Fixed via a new `instrumentation.ts`
(`onRequestError` hook, stable since Next 15) that classifies Prisma-
shaped errors and logs `database_read_failed` (render-time) or
`database_request_failed` (Action/Route-Handler-time), with
`requestId`, `routeType`, `path`, and the Prisma error code — verified
end-to-end: a real outage now produces a log line like:
```json
{"timestamp":"...","level":"error","event":"database_read_failed","requestId":"e22040de-...","routeType":"render","path":"/","method":"GET","error":{"name":"PrismaClientKnownRequestError","code":"P1017","message":"...Server has closed the connection."}}
```
No `DATABASE_URL`, credential, or SQL parameter appears in this or any
other captured log line (asserted directly in the chaos test). No
migration required — a new root-level file, no schema change.

### B — DB disconnect mid multi-write transaction

Used `generateAndSaveDutySchedule`'s existing, documented test-only
`writeAuditLogFn` seam (added in an earlier pass specifically "to prove
the rollback boundary, without weakening or bypassing it") to capture
the real transaction's own backend pid and terminate *that exact
connection* — a real PostgreSQL-level kill, not a mocked Prisma
rejection — after the `DutySchedule` and `DutyAssignment` rows were
written but before commit.

**Result: real PostgreSQL rollback, zero exceptions.** After the call
threw (as required — the caller receives failure, never success):
`DutySchedule` count for that (region, year, month) = 0,
`DutyAssignment` count = 0, `DutyScheduleWarning` count = 0, matching
`AuditLog` count = 0. PostgreSQL's own transactional atomicity handled
this correctly with no application-level compensation logic needed. No
fix required — this scenario passed on first evidence.

### C — DB restart and recovery

Full local PostgreSQL *service* restart (not just a backend kill).

- Reads and writes issued during the outage both failed in a bounded,
  controlled way; the app process stayed alive.
- **Recovery timing differs meaningfully by fault type**: after a
  single targeted backend termination, the *next* query on that
  connection fails once and the one after immediately succeeds
  (sub-millisecond self-heal). After a **full service restart**, every
  pooled connection is simultaneously stale — recovery took
  **~12.5 seconds** in repeated measurement in this sandbox before a
  fresh query succeeded again, no application restart required. This is
  a real, measured difference worth knowing operationally: a full DB
  restart is meaningfully slower to recover from than a single dropped
  connection, even though both eventually self-heal without
  intervention.
- **Idempotent-safe write retried manually**: `logoutAction` (its
  underlying `session.deleteMany({ where: { token } })` is a no-op on
  an already-deleted row) was called twice in a row against the same
  now-gone session — both calls completed with the same real redirect
  signal, no error, no duplicate effect.
- **Non-idempotent write, single-attempt confirmed**: a call counter
  was patched directly onto the app's own `prisma.region.findUnique`
  (the first read inside `generateAndSaveDutySchedule`) while
  PostgreSQL was down. **Exactly one attempt** was recorded before the
  call threw — empirical confirmation that the "no retry wrapper exists"
  code-inspection finding above is also true in practice. Zero
  `DutySchedule` rows exist afterward.

### D — connection-pool pressure

A dedicated `PrismaClient` with `connection_limit=5&pool_timeout=5`
against the real chaos database.

| Concurrency | Success | Error | Pool timeouts | p50 | p95 |
| --- | --- | --- | --- | --- | --- |
| 10 reads | 10 | 0 | 0 | 10ms | 32ms |
| 25 reads | 25 | 0 | 0 | 4ms | 5ms |
| 50 reads | 50 | 0 | 0 | 6ms | 8ms |
| Mixed: 20 reads | 20 | 0 | 0 | 5ms | 14ms |
| Mixed: 10 writes | 10 | 0 | 0 | 11ms | 15ms |

**No pool exhaustion was observed at these concurrency levels** — a
5-connection pool queued and served up to 50 concurrent requests
without a single `P2024` (pool timeout), because per-query latency in
this sandbox (single-digit milliseconds) is far shorter than the
5-second `pool_timeout` even when requests queue behind the pool's 5
active connections. This is expected, correct behavior — Prisma queues
excess requests rather than rejecting immediately — and is itself
useful evidence that the pool's queueing (not just its raw connection
count) is the operative capacity mechanism at low-latency local scale.

**No connection leak**: `pg_stat_activity` count returned to baseline
(±1, tolerance for the assertion query's own connection) within the
10-second bounded poll after the pressured client's `$disconnect()`.
Process RSS was stable (101.0MB → 101.4MB across the whole scenario).

### E — lock contention

Two real, concurrent PostgreSQL transactions per test, gated on a
`Promise` barrier (deterministic, never a sleep).

- **Advisory lock** (`pg_advisory_xact_lock`, the real
  `assertLastActiveAdminNotRemoved` last-active-admin guard): a second
  transaction with `SET LOCAL lock_timeout = '800ms'` waited
  ≥700ms and <3000ms, then failed with a real PostgreSQL `55P03`
  ("canceling statement due to lock timeout"), wrapped by Prisma as
  `P2010`. The lock holder's own transaction was unaffected and
  committed cleanly once released. A fresh attempt after release
  succeeded immediately.
- **Row lock** (a plain `Pharmacy` row `UPDATE` held open by one
  transaction): the same pattern — a concurrent updater with a scoped
  `lock_timeout` was bounded, failed in a controlled way, left **no
  partial/lost-update commit** (only the holder's value was persisted
  after both transactions concluded), and a subsequent request
  succeeded once the row lock was released.

**Real defect found and fixed**: the two `database_pool_timeout` (P2024)
and `database_lock_timeout` (P2010 wrapping PostgreSQL `55P03`) cases
were previously indistinguishable in logs from any other generic DB
failure. `instrumentation.ts` now classifies both by their specific
Prisma/PostgreSQL error code into their own event names — an
operationally meaningful distinction (pool sizing vs. lock contention
call for different responses), confirmed against the real error shapes
produced by this scenario. No migration required.

### F — data-health cache failure and recovery

Used `getDataHealthReport`'s existing `{ now }` test seam (no 60-second
real wait). A refresh forced past the 60s TTL while PostgreSQL was down
threw, and `data_health_report_failed` was logged (already existing,
pre-Step-6 logging — confirmed correct, no fix needed). The failed
refresh did **not** poison the cache with invalid data (the module-level
`cachedReport` is only ever assigned on a successful fetch — confirmed
by code inspection and by this test's behavior). A subsequent refresh,
once PostgreSQL was restored, returned a valid, well-formed report
(`critical`/`warnings`/`info` all present as arrays). No endless failure
loop: exactly the two forced-refresh attempts in this test, one failed,
one succeeded.

### Login/rate-limiter behavior during a DB outage

`loginAction` has no try/catch anywhere in its own body. Tested at all
three specified points, against the real function:

1. **Before the rate-limit check** (`checkLoginRateLimit`'s `findMany`
   is the very first DB call): throws immediately.
2. **After credential verification, before session creation**
   (`prisma.session.create` patched to trigger the outage at exactly
   that instant): throws; **zero** `Session` rows exist for that user
   afterward — no orphan/partial session state.
3. **During failed-attempt recording** (`prisma.$queryRaw`, the atomic
   upsert inside `recordLoginFailure`, patched to trigger the outage at
   exactly that instant): throws.

**Determined policy: fails CLOSED at every point.** No path silently
grants a session, bypasses the rate limiter, or falls back to a
degraded-but-functional login. Every failure produces the same class of
generic error regardless of whether the submitted account exists or the
password was right or wrong — **no account-existence leakage** through
any of the three outage points, consistent with the pre-existing
generic-failure-message design (`docs/security/02-authentication-session-handling.md`).
No raw DB error, connection string, or credential reaches the caller in
any case (asserted directly).

**Real defect found and fixed**: `loginAction` logged
`auth_login_succeeded` **before** calling `createSession` — verified by
this scenario's point-2 test, where the log line appeared even though
session creation then failed and the whole action threw. This is a
genuine (minor, non-security) observability bug: an operator reading
logs would see a "succeeded" event for a login that never actually
established a session. **Fix**: moved the log call to after
`createSession()` succeeds (`src/lib/auth/actions.ts`). All 15
pre-existing `actions.test.ts` unit tests continued to pass unchanged
(they assert on `createSession` being called, not on log-call
ordering). No migration required.

## Bugs found and fixes — summary

| # | Finding | Fix | File | Migration? |
| --- | --- | --- | --- | --- |
| 1 | DB read failures during page render were never logged | Added `instrumentation.ts`'s `onRequestError` hook | `instrumentation.ts` (new) | No |
| 2 | Pool-timeout (P2024) and lock-timeout (P2010/55P03) errors were logged under a generic event name, indistinguishable from any other DB failure | Classified both into `database_pool_timeout` / `database_lock_timeout` event names in the same hook | `instrumentation.ts` | No |
| 3 | A connection string with embedded credentials, if present inside a thrown error's `.message` (confirmed against a real `PrismaClientInitializationError` shape), could survive `toSafeError()`'s length-only truncation and reach a log line | Added connection-string-shaped-substring redaction before truncation | `src/lib/observability/logger.ts` | No |
| 4 | `loginAction` logged `auth_login_succeeded` before `createSession()` actually succeeded | Moved the log call to after session creation | `src/lib/auth/actions.ts` | No |

All four fixes are logging/observability-only — no product behavior,
API shape, or persisted-data schema changed. No new runtime dependency
was added.

## Connection and memory observations

- `max_connections` on the local PostgreSQL instance: 100 (well above
  anything exercised in this suite — the highest concurrent count
  observed was ~9, Prisma's own default pool size).
- No permanent connection leak observed in scenario D.
- Process RSS was stable across pool-pressure testing (no unbounded
  growth).

## `database_connection_recovered` — deliberately not added

Item 11 named five candidate events. Four were added or confirmed
already present/now added (`database_read_failed`,
`database_pool_timeout`, `database_lock_timeout`, and the pre-existing
`data_health_report_failed`/`auth_login_*` family covers the
transaction/request-failure and login-outage cases). A distinct
`database_connection_recovered` event was considered and **not added**:
detecting "recovery" generically would require tracking per-request or
per-connection failure state across time (e.g. "was the previous
request for this route a DB failure?") — genuinely new stateful
machinery, not a a redaction/classification tweak to an existing error
path. Given this step's explicit instruction not to add speculative
mechanisms and to prefer the smallest evidence-justified change, this is
flagged as a documented gap/future-improvement rather than implemented
here. Prisma's connection recovery is silent and automatic by design
(confirmed in scenarios A and C) — this gap is an observability nice-
to-have, not a correctness or security risk.

## Test counts

- 8 new chaos spec files, 18 chaos tests total (all passing, run twice
  consecutively as the final verification step — see commit).
- New unit tests: `resolveChaosDatabaseUrl` (9 cases, in
  `test-db-guard.test.ts`, 73 total in that file), `validateFaultTarget`
  (4 cases), chaos `validateManifestForCleanup` (6 cases), 3 new
  redaction-under-DB-error tests in `logger.test.ts` (16 total in that
  file, up from 13).
- All pre-existing unit/integration/E2E/perf tests remain green (558
  unit tests total, up from 555 before this step; 13 integration; 29
  E2E).

## Remaining risks

1. **Railway production topology cannot be locally simulated** —
   connection-draining behavior during a managed restart/failover, any
   pooler Railway places in front of PostgreSQL, and real network
   partial-failure modes (as opposed to "fully down") are untested.
2. **No network-level fault injection** (latency injection, partial
   packet loss) — only "reachable" vs. "fully unreachable" was tested
   locally, since Toxiproxy wasn't available in this sandbox.
3. **`database_connection_recovered` is not logged** — documented gap
   above; Prisma's own self-healing is silent by design and this adds
   no correctness risk, only a minor observability gap.
4. **A full local PostgreSQL service restart's ~12.5s pool-recovery
   time is sandbox-specific** — should be re-measured against a real
   staging/Railway environment before being treated as an operational
   expectation.

## Pilot-readiness conclusion

The application's actual, observed behavior under every tested failure
mode is **fail-closed, non-destructive, and self-recovering without
manual intervention**: reads and writes both fail safely and visibly
(now logged, previously silent for one class of failure); real
PostgreSQL transactional atomicity was proven to hold under a genuine
mid-transaction disconnect; no retry-induced duplicate writes are
possible because no retry mechanism exists; connection-pool pressure at
tested concurrency levels queues rather than fails; lock contention is
boundable via `lock_timeout` and never produces a partial commit; the
data-health cache and the login rate limiter both already had (or now
have) a correctly fail-closed, non-poisoning outage story. Combined with
Step 5's query-plan findings, the system is suitable for the expected
pilot's database-resilience needs at a single-instance-on-Railway
topology — the residual risks above are about *validating this same
behavior against Railway's actual infrastructure*, not about the
application's own logic.
