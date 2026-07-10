# Test Gap & Assertion Quality — Part A

Date: 2026-07-10, same branch (`deploy/postgresql-demo`).

## Scope

A prior read-only sweep mapped the existing ~259-test suite against risk
rather than coverage percentage, and found that several security- and
money-critical modules had **zero direct test coverage** (only ever
exercised as mocks in other files' tests), that every "concurrency" test
in the suite actually only proves error-message translation for a single
mocked P2002 rejection (never a genuine race), and that a handful of
boundary values (leap years, the public-request cap, exact expiry/gap
ties) were never exercised. This document covers **Part A**: the
mocked-Prisma unit/behavior tests addressing the highest-value gaps.
**Part B** (real-Postgres concurrency tests proving the DB unique
constraints — not just their error-mapping — actually serialize
concurrent operations) is explicitly out of scope for this pass and is
listed at the end of this document.

## Risk-based test inventory (before this pass)

| Module | Risk | Direct test file before this pass |
|---|---|---|
| `src/lib/auth/password.ts` | Auth — password verification | **None** |
| `src/lib/auth/session.ts` | Auth — the app's core session gate | **None** |
| `src/lib/auth/permissions.ts` | Authorization — role → permission matrix | **None** (only incidentally exercised via 2 checks in `guard.test.ts`) |
| `src/lib/balance/duty-balance.ts` | Money/scoring — feeds fairness algorithm + `/nobet-dengesi` report | **None** |
| `src/lib/scheduling/date-tr.ts` | Date arithmetic underlying every scheduling test (leap years never exercised) | **None** |
| `src/lib/scheduling/generate-duty-schedule.ts` | Core scheduling algorithm | Existing (16 tests), but missing all-unavailable / dailyDutyCount-exceeds-roster boundaries |
| `src/app/eczane-talep/[token]/actions.ts` | Public abuse-prevention cap | Existing (dedup tests only; `MAX_OPEN_PUBLIC_REQUESTS` never exercised — `count` hardcoded to `0` in every test) |
| `src/app/(dashboard)/denetim-kayitlari/page.tsx` | Security/compliance audit trail viewer | Existing but weak (`toHaveBeenCalled()`/`toBeTruthy()` only, no argument or output checking) |

## Part A tests added

| # | File | New tests | What it proves |
|---|---|---|---|
| 1 | `src/lib/auth/password.test.ts` (new) | 13 | Real scrypt round-trip (hash→verify); different password rejected; every malformed-hash shape (no separator, empty, missing half, invalid/truncated hex, short-but-valid hex) returns `false` without throwing; empty/whitespace passwords don't crash the primitive |
| 2 | `src/lib/auth/session.test.ts` (new) | 18 | Valid/expired/exact-boundary/deactivated-user session outcomes for `getCurrentUser`; `requireUser` redirect behavior; `destroySession`/`invalidateUserSessions` idempotency; `createSession` token uniqueness and cookie flags |
| 3 | `src/lib/auth/permissions.test.ts` (new) | 30 | The full 3-role × 8-permission matrix (24 explicit cells) plus 6 named security invariants (ADMIN has everything, STAFF lacks `manageUsers`/`deleteSetupData`/`deleteSchedule`, VIEWER can only `exportSchedule`, unrecognized role fails closed) |
| 4 | `src/lib/balance/duty-balance.test.ts` (new) | 12 | Zero-fallback correctness (never `NaN`/`undefined`); JS-side accumulation of multiple historical records; positive/negative/net-zero adjustments; a pharmacy missing from a grouped aggregate still appears zeroed; output order follows DB-provided order (no re-sort); `regionId` scoping reaches every underlying query; `getOpeningBalanceByPharmacy` correctly unions historical-only and adjustment-only pharmacies |
| 5 | `src/app/eczane-talep/[token]/actions.test.ts` (extended) | +4 | `MAX_OPEN_PUBLIC_REQUESTS` at 9 (accepted) / 10 (rejected) / 11 (still rejected), with the exact Turkish message and zero `create` calls on rejection; the open-request count query is confirmed scoped to `status: "PENDING"` only |
| 6 | `src/lib/scheduling/generate-duty-schedule.test.ts` (extended) | +3 | Every pharmacy unavailable all month → zero assignments, a warning every day; the `minDaysBetweenDuties` pool-relaxation fallback never starts assigning an unavailable pharmacy even when the gap constraint alone would otherwise force it to; `dailyDutyCount` exceeding the roster size fills only as many slots as pharmacies exist |
| 7 | `src/lib/scheduling/date-tr.test.ts` (new) | 24 | `daysInMonth` for common/leap/century-non-leap(1900)/century-leap(2000) Februaries and normal 30/31-day months; `dateAtUtcMidnight`'s no-shift contract; `toDateKey`/`parseDateKey` round trips including the Feb 29 boundary; `diffInDays` across a leap day; `addDays` across leap vs. non-leap February boundaries; weekday classification; Turkish name lookups including out-of-range month handling |
| 8 | `src/app/(dashboard)/denetim-kayitlari/page.test.ts` (strengthened) | 11 (was 4) | Exact `select`/`orderBy`/pagination shape (proving no `passwordHash`/token is ever selected); `Pagination` component props reflect the real DB count; rendered rows show the correct actor/action/entity/timestamp; a defense-in-depth check that even a hypothetical extra `passwordHash`/`sessionToken` key in the stored audit JSON never renders; empty-state title asserted via component props (not a brittle text-walk) |

**Total: 111 new tests** (259 → 370), across 5 new test files and 3
strengthened existing files.

## A real bug found and fixed

Writing the malformed-hash tests for `password.test.ts` surfaced a
genuine, previously-undiscovered authentication bug in
`src/lib/auth/verifyPassword`:

**Before:** `Buffer.from(key, "hex")` silently truncates at the first
invalid hex character instead of throwing (a Node.js `Buffer` behavior,
not a bug in this codebase). For a stored hash whose key half contains
no valid hex digits at all (e.g. a corrupted `passwordHash` value like
`"somesalt:zz"`), this decodes to an **empty (0-byte) buffer**.
`verifyPassword` then asked `scrypt` to derive a 0-length key (which
Node happily returns as an empty buffer, again without throwing), and
`timingSafeEqual` on two empty buffers trivially returns `true` —
**meaning a corrupted stored hash of this specific shape would accept
any password, unconditionally.**

**Likelihood:** low — this requires the `User.passwordHash` column to
already be corrupted (e.g. direct DB tampering, a botched manual data
fix, or a future bug elsewhere that writes a malformed hash) rather than
being reachable through any normal user-facing flow (`hashPassword`
always produces a full 128-hex-char key). But it is a real, silent
authentication bypass for that corrupted-data state, with zero prior
test coverage that would have caught it.

**Fix (`src/lib/auth/password.ts`):** added a guard immediately after
the hex decode — `if (keyBuffer.length === 0 || keyBuffer.length * 2 !==
key.length) return false;` — which rejects any truncated/invalid hex
decode before it ever reaches `scrypt`/`timingSafeEqual`. A
well-formed key (any even-length valid hex string, including every real
`hashPassword`-produced 128-char key) is unaffected; this was verified
by the real-scrypt round-trip tests in the same file continuing to pass
unchanged, and by the full existing `auth/actions.test.ts` suite (which
mocks `verifyPassword` and is therefore untouched by this fix) still
passing.

No other production code was changed in this pass — every other test
added exercises pre-existing, correct behavior and locks it in.

## Weak assertions corrected

- `src/app/(dashboard)/denetim-kayitlari/page.test.ts`'s "ADMIN can
  access" test previously asserted only
  `expect(prismaMock.auditLog.findMany).toHaveBeenCalled()` (no argument
  checking) and `expect(...).resolves.toBeTruthy()` (any non-falsy
  return value, including a broken page, would pass). Both are now
  replaced with exact `select`/`orderBy`/pagination argument assertions
  and rendered-content assertions (actor name, translated action/entity
  labels, formatted timestamp, and the specific role-change detail
  text), plus a dedicated negative test that a hypothetical sensitive
  field embedded in stored audit JSON never reaches the rendered output.

## Modules that previously had zero direct coverage (now covered)

`src/lib/auth/password.ts`, `src/lib/auth/session.ts`,
`src/lib/auth/permissions.ts`, `src/lib/balance/duty-balance.ts`,
`src/lib/scheduling/date-tr.ts` — all five now have dedicated test files
exercising their real (unmocked, where applicable) implementations
rather than only ever appearing as a `vi.mock(...)` stand-in in other
modules' tests.

## Test design notes (matching the task's assertion-quality requirements)

- **No wall-clock sleeps anywhere.** `session.test.ts`'s expiry-boundary
  tests use `vi.useFakeTimers()` + `vi.setSystemTime(...)`, restored via
  `vi.useRealTimers()` in an `afterEach`.
- **No shared mutable fixtures / order dependence introduced.** Every
  new test file follows the existing codebase convention: factory
  functions per test, `vi.clearAllMocks()` in `beforeEach`, no
  module-level `let` accumulators. `data-health.ts`'s module-level TTL
  cache (a pre-existing, out-of-scope concern noted by the sweep) was
  not touched in this pass.
- **No implementation-detail-only assertions were added.** Where a test
  does assert on a Prisma call's exact shape (`duty-balance.test.ts`'s
  `regionId` scoping test, `denetim-kayitlari`'s `select` shape test),
  it's specifically because that shape *is* the security/business
  guarantee being verified (region scoping, exclusion of
  `passwordHash`) — the same principle already established in this
  codebase's existing `toHaveBeenCalledExactlyOnceWith` usages.
- **Every new test would fail if its corresponding real bug occurred** —
  confirmed for the password.ts case by observing the new test actually
  fail against the pre-fix code (see "A real bug found and fixed"
  above) before the fix was applied.

## Remaining Part B gaps (real-Postgres concurrency — not done in this pass)

The sweep's most significant structural finding stands: **every
"duplicate submission" test in this codebase — old and new — proves
that the app correctly translates a single, pre-mocked `P2002` rejection
into a friendly response. None of them prove that two genuinely
concurrent operations against the same unique key actually result in
exactly one success**, because the entire test suite mocks Prisma and
never touches a real database, so there is no real unique-constraint
enforcement to race against in Part A.

Part B — deferred, requires a real PostgreSQL instance (not started in
this pass) — should cover:

1. **Schedule transaction rollback**: fire a real
   `generateAndSaveDutySchedule` against a live Postgres instance with a
   deliberately-failing step partway through (e.g. an injected
   constraint violation on `DutyScheduleWarning`) and confirm the
   `DutySchedule` and `DutyAssignment` rows are NOT left behind
   (transaction actually rolled back, not just "the mock wasn't called
   again").
2. **Concurrent public duty-request dedup**: fire two truly overlapping
   `createPublicDutyRequestAction` calls (e.g. `Promise.all([...])`)
   against a real `DutyRequest.dedupKey` unique index and confirm
   exactly one `DutyRequest` row is created and the other observes the
   friendly duplicate response — not two sequential, individually-mocked
   calls.
3. **Concurrent historical import fingerprint dedup**: same
   two-overlapping-calls shape against a real
   `HistoricalDutyImportBatch.fingerprint` unique index.
4. **Concurrent schedule/assignment unique-constraint behavior**: two
   overlapping `createDutyScheduleAction` calls for the same
   region/month/year against the real `DutySchedule` unique index, and
   two overlapping `editDutyAssignmentAction` calls double-booking the
   same pharmacy/date against the real `DutyAssignment` unique index.

**Why this matters as a distinct claim from Part A:** a mocked-P2002
test only proves the *error-handling branch* works when the database
happens to reject a write. It does not prove the database *will*
reject the second of two simultaneous writes in the first place (that's
a property of the actual unique index and Postgres's own concurrency
control, not of this application's code), nor does it rule out a future
regression where an in-memory cache or an early-return optimization is
added ahead of the database write and inadvertently lets two truly
simultaneous requests both slip through before either reaches the
constraint. Only a real-database test with genuinely overlapping calls
closes that gap.

## Verification performed

- `npx tsc --noEmit` — clean
- `npm run lint` — clean
- `npm test` — 370/370 passing (111 new tests; every new test file also
  run individually before the full-suite run)
- `npm run build` — production build succeeds against a real local
  PostgreSQL instance, all routes registered, including the new
  `password.ts` guard
- No schema or migration changes — confirmed via `git status` showing
  no changes under `prisma/`
- No dependency changes — confirmed via `git diff package.json
  package-lock.json` showing no output
- No production code behavior change beyond the one genuine bug fix in
  `src/lib/auth/password.ts`, confirmed via `git diff --name-only`
  against non-test files under `src/`
- No test relies on wall-clock sleeps or a shared mutable fixture

## Part B — real-PostgreSQL integration tests

Part A's 370 unit tests all mock `@/lib/prisma`. A "concurrent duplicate
write" unit test can only prove that when Prisma *is told* to reject a
write with a canned `P2002`, the calling code maps that rejection to the
right friendly message. It cannot prove that the database's actual
unique index will, in fact, serialize two genuinely simultaneous writes
down to one winner — that guarantee lives in Postgres, not in mocked
TypeScript. Part B closes that gap: every test below runs the real,
unmodified application code (the actual exported Server Action or
transaction function) against a real, disposable PostgreSQL database,
with two operations launched to genuinely overlap.

### Integration-test architecture

- **Location**: `tests/integration/*.integration.test.ts`, with shared
  helpers in `tests/integration/helpers/`.
- **Separate Vitest project**: `vitest.integration.config.ts` is a
  completely separate config from `vitest.config.ts`. The base
  `vitest.config.ts` now excludes `tests/integration/**`
  (`test.exclude`), so plain `npm test` never touches a database and
  stays exactly as fast as before. The integration suite only runs via
  the explicit `npm run test:integration` command.
- **Real seams, minimal mocking**: the only modules ever mocked for
  integration tests are the three Next.js runtime APIs that literally
  cannot function outside an actual HTTP request/render —
  `cookies()`/`headers()` from `next/headers`, `redirect()` from
  `next/navigation`, and `revalidatePath()` from `next/cache`
  (`tests/integration/helpers/setup.ts`, registered as a per-worker
  Vitest `setupFiles` entry). `redirect()` is stubbed to throw a
  distinguishable `IntegrationRedirectSignal` instead of doing nothing,
  so tests can assert "the action reached its success path" without a
  real HTTP response object. Every other module — Prisma, all business
  logic, `$transaction` boundaries, dedup-key computation, fingerprint
  computation, audit logging, the advisory-lock admin guard — is the
  real, unmodified production code.
- **Authenticated calls**: rather than mocking `getCurrentUser()`, tests
  create a real `User` and a real `Session` row in the test database,
  then use `setIntegrationTestSessionToken()` (exported from
  `setup.ts`) to point the mocked `cookies().get("session_token")` at
  that real token. `getCurrentUser()`'s own Prisma lookup runs
  unmodified against real data.

### `TEST_DATABASE_URL` safety guard

`tests/integration/helpers/test-db-guard.ts` is the single choke point
that decides whether it's safe to point Prisma at a database and run
destructive setup/cleanup. It fails fast (throws, refuses to run) unless
**all** of the following hold:

1. `TEST_DATABASE_URL` is set explicitly — there is no fallback to
   `DATABASE_URL`. An unset `TEST_DATABASE_URL` means "don't run",
   never "use production by accident."
2. `TEST_DATABASE_URL` is not byte-identical to `DATABASE_URL`.
3. The database name parsed out of `TEST_DATABASE_URL` contains `"test"`
   (case-insensitive).

No part of the connection string (which may embed credentials) is ever
logged — only the bare database name. This guard runs in two places:
once in `global-setup.ts` (Vitest `globalSetup`, a separate process,
before migrations are applied) and again in `setup.ts` (Vitest
`setupFiles`, per worker process, before `process.env.DATABASE_URL` is
overridden for that worker) — `globalSetup` and worker processes do not
share `process.env`, so the check must run in both.

`src/lib/env.ts`'s `validateEnv()` extracts `databaseUrl` from
`process.env.DATABASE_URL` unconditionally and only *requires* it to be
set outside `NODE_ENV=test`; `src/lib/prisma.ts` constructs its
`PrismaClient` with `datasourceUrl: env.databaseUrl`. So simply setting
`process.env.DATABASE_URL = TEST_DATABASE_URL` before any app module is
imported (which `setup.ts` does at module load, before any test file's
`import` statements resolve) is sufficient to redirect the real Prisma
client at the test database — no changes to `env.ts` or `prisma.ts`
were needed.

### Migrations, setup, and cleanup strategy

- **Migrations**: `global-setup.ts` runs `npx prisma migrate deploy`
  once, in a separate subprocess, with `DATABASE_URL` overridden to
  `TEST_DATABASE_URL` for that subprocess only — the same command used
  for production deploys, applied to the test database before any test
  file runs.
- **Fixtures**: `tests/integration/helpers/fixtures.ts` provides
  `createTestRegion`, `createTestDutyRule`, `createTestPharmacy`,
  `createTestUser`, and `createTestSessionToken`, each of which both
  creates a real row and appends its id to a per-test `TrackedIds`
  accumulator. Every row name/email is suffixed with a short
  `testRunId()` (`randomUUID().slice(0, 8)`) so that even concurrent
  test runs against a shared database can never collide.
- **Cleanup**: `cleanupTrackedIds()` deletes **only** the rows whose ids
  were tracked by that test, in FK-safe order (children before
  parents — e.g. `DutyScheduleWarning`/`AuditLog`/`DutyAssignment`
  before `DutySchedule`; `Session`/`AuditLog` before `User`). It never
  issues a table-wide `deleteMany({})`, so it is safe even on a shared
  test database and can never affect another test's or another
  developer's data. Every scenario file calls this in `afterEach`.
- **No sleeps**: `tests/integration/helpers/gate.ts` provides a
  deferred-promise barrier (`createGate()`/`raceThroughGate()`). Both
  competing operations are invoked as async closures that each `await
  gate` as their very first statement — since nothing precedes that
  await, both closures are already suspended by the time `release()` is
  called synchronously, so both resume and issue their real database
  calls in the same microtask tick. This is the only synchronization
  mechanism used to force overlap; no test uses `setTimeout`/`sleep` for
  correctness.
- **Execution order**: `vitest.integration.config.ts` sets
  `fileParallelism: false` so scenario files run strictly sequentially
  against the shared test database, avoiding any cross-file races on
  top of the deliberate in-file ones.

### Concurrency scenarios covered

| # | File | Real path exercised | DB guarantee proven |
|---|------|---------------------|----------------------|
| 1 | `public-duty-request-dedup.integration.test.ts` | `createPublicDutyRequestAction` | `DutyRequest.dedupKey` unique constraint: two genuinely concurrent identical public submissions produce exactly one `DutyRequest` row; one caller gets the fresh-success message, the other the friendly duplicate notice; after `reviewDutyRequestAction` closes the request (`dedupKey` cleared to `null`), a new identical submission succeeds and a second historical `DutyRequest` row can coexist. |
| 2 | `historical-import-fingerprint-dedup.integration.test.ts` | `historicalImportAction` (import mode) | `HistoricalDutyImportBatch.fingerprint` unique constraint: two concurrent imports of the identical accepted-row payload produce exactly one batch and exactly one record set; the loser receives exactly `"Bu geçmiş nöbet aktarımı daha önce içeri alınmış."`; `getOpeningBalanceByPharmacy` (real duty-balance aggregation) reflects the weight exactly once, not twice. |
| 3 | `schedule-transaction-rollback.integration.test.ts` | `generateAndSaveDutySchedule` | The `$transaction` boundary around `DutySchedule`/`DutyAssignment`/`DutyScheduleWarning`/`AuditLog` creation: when the audit write fails (via a new, production-default-preserving `writeAuditLogFn` injection seam — see below), **no** row from any of those four tables is left behind; a control-case test confirms the same transaction commits all rows together when nothing fails. |
| 4 | `schedule-uniqueness-concurrency.integration.test.ts` | `generateAndSaveDutySchedule` | `DutySchedule @@unique([year, month, regionId])`: two concurrent generation calls for the same region/year/month leave exactly one `DutySchedule` row; the loser fails with a raw `P2002` (the exact error `createDutyScheduleAction`'s existing, already-unit-tested catch block maps to the friendly duplicate message); no orphaned assignment/warning rows exist from the losing transaction. |
| 5 | `duty-assignment-uniqueness-concurrency.integration.test.ts` | `editDutyAssignmentAction` | `DutyAssignment @@unique([dutyScheduleId, pharmacyId, date])`: two assignments on the same date, edited concurrently to the same target pharmacy, leave exactly one assignment occupying that pharmacy/date; the loser gets exactly `"Bu eczane aynı tarihte bu çizelgede zaten nöbetçi olarak atanmış."`; the schedule keeps exactly two assignments total; exactly one `AuditLog` row is committed. |
| 6 | `last-active-admin-concurrency.integration.test.ts` | `setUserStatusAction` | The `pg_advisory_xact_lock`-serialized last-active-admin guard: with exactly two active ADMIN users, each concurrently deactivating the other, exactly one deactivation commits and the other is rejected by `LastActiveAdminError` — the system never reaches zero active admins; exactly one `AuditLog` row is written. |

Every test asserts **persisted database state** after the race — row
counts, the specific unique field values, child-row consistency, and
audit-log counts — never only the returned message, a mock call count,
or "ran without throwing."

### The `writeAuditLogFn` testability seam

`generateAndSaveDutySchedule` had no way to force a failure partway
through its transaction without weakening the transaction boundary
itself or monkey-patching Prisma internals. The minimal fix: the
function now accepts an optional `writeAuditLogFn` parameter, defaulting
to the real `writeAuditLog`:

```ts
export async function generateAndSaveDutySchedule({
  month,
  year,
  regionId,
  userId,
  writeAuditLogFn = writeAuditLog,
}: GenerateAndSaveDutyScheduleInput) { ... }
```

Production call sites never pass this argument, so production behavior
is byte-identical to before. The integration test passes a stub that
throws, and because it still runs *inside* the same `tx` the real
`writeAuditLog` would have used, the failure occurs inside the real
transaction — proving the rollback boundary, not bypassing it.

### Guarantees now proven against real Postgres (not just mocked)

- `DutyRequest.dedupKey`, `HistoricalDutyImportBatch.fingerprint`,
  `DutySchedule([year, month, regionId])`, and
  `DutyAssignment([dutyScheduleId, pharmacyId, date])` unique
  constraints all genuinely serialize concurrent writes down to exactly
  one winner, under real overlapping database calls — not simulated by
  mocking a `P2002` rejection.
- The `generateAndSaveDutySchedule` transaction is atomic: a failure
  after `DutySchedule` creation but before commit leaves zero rows in
  any of the four tables it writes to.
- The `pg_advisory_xact_lock`-based last-active-admin guard correctly
  serializes two concurrent deactivation attempts and never allows a
  zero-active-admin state to commit.
- The public duty-request dedup key is correctly cleared on review
  closure, re-enabling a legitimately new submission afterward, proven
  against the real DB round-trip (not a mocked `update`).

### Remaining untested risks (not covered by Part A or Part B)

- Three or more genuinely concurrent operations racing the same unique
  key (only two-way races are exercised here).
- Behavior under real network partition or Postgres connection-pool
  exhaustion during a transaction (Part B proves logical rollback
  correctness, not infrastructure-failure resilience).
- CI/Railway currently has no `TEST_DATABASE_URL` configured — see
  "CI/opt-in status" below.

### CI / opt-in status

`npm run test:integration` is **opt-in**, not run automatically as part
of the default test command. If `TEST_DATABASE_URL` is unset in an
environment (including CI or Railway, unless explicitly configured),
the suite fails immediately and loudly via the safety guard described
above — it never silently skips and never falls back to
`DATABASE_URL`. To run it, provision a dedicated PostgreSQL database
whose name contains `"test"` (e.g. `pharmacy_duty_scheduler_test`), set
`TEST_DATABASE_URL` to its connection string, and run `npm run
test:integration`.

### Unit tests vs. integration tests — the distinction this Part B closes

| | Part A (unit, `npm test`) | Part B (integration, `npm run test:integration`) |
|---|---|---|
| Database | Mocked (`vi.mock("@/lib/prisma")`) | Real PostgreSQL |
| Concurrency | Simulated via a canned `P2002` rejection | Genuinely overlapping calls via a deferred-promise gate |
| Proves | Error-message translation is correct | The database itself serializes concurrent writes to one winner |
| Speed | ~5s for 370 tests | ~5-6s for 8 tests (real DB round-trips) |
| Isolation | Fully isolated, no shared state | Shares a database; isolated via per-test tracked-id cleanup |
| Runs in CI by default | Yes | No — opt-in, requires `TEST_DATABASE_URL` |
