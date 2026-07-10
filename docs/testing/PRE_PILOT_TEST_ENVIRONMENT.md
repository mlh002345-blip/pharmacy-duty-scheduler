# Pre-Pilot Test Environment Procedure

Step 1 of the pre-pilot infrastructure and security test plan: **Test
Environment Safety Baseline**. This document exists to guarantee that
every upcoming load, backup/restore, resilience, and security test can
run without any possibility of touching the production database.

This document does not change any product feature, database schema, or
migration. It only describes and hardens the existing, already-separate
test-environment tooling (`npm test`, `npm run test:preflight`,
`npm run test:integration`).

## 1. Required staging/test services

- A dedicated **PostgreSQL** instance or database, separate from
  whatever `DATABASE_URL` points at for local development, staging, or
  production. This can be:
  - a local PostgreSQL install (used for this document's own
    verification — see "Exact sanitized database used" in the
    accompanying summary), or
  - a dedicated staging PostgreSQL instance provisioned specifically for
    pre-pilot testing (recommended for load/backup/restore/resilience
    tests that need realistic data volume or Railway-like network
    conditions).
- Node.js + the project's existing `npm ci`-installed dependencies — no
  new runtime dependency was added for this baseline.
- No other external service is required. The app has no queue, cache
  service, or third-party API dependency (confirmed in prior sweeps,
  `docs/security/11-external-calls-timeouts-resilience.md`).

**Never point any test/staging service at the real production
`DATABASE_URL`.** Production stays reachable only via its own dashboard-
managed `DATABASE_URL` for the running application — no test tooling in
this repository ever reads or writes it directly (see the safety guard
below).

## 2. `TEST_DATABASE_URL` naming convention

`TEST_DATABASE_URL` must be a `postgresql://` or `postgres://`
connection string whose **database name** (the path component, e.g.
`pharmacy_duty_scheduler_test`) contains one of these markers,
case-insensitively:

- `test`
- `testing`
- `integration`

Additionally, **neither the hostname nor the database name** may contain
a production-sounding marker — `prod`, `production`, or `live` — even if
a test marker is also present. A database named `production_test` is
still rejected; the production-marker check always wins.

Recommended naming: `pharmacy_duty_scheduler_test` (used throughout this
repository's own examples and CI/local verification).

This is enforced in code by
`tests/integration/helpers/test-db-guard.ts`'s `resolveTestDatabaseUrl()`
— the single choke point used by every test command below. It is not a
convention you have to remember to follow manually; violating it makes
the relevant command refuse to start.

## 3. Prohibited production operations

The following must **never** be done as part of test/load/resilience
work:

- Never set `TEST_DATABASE_URL` to the same value as the production
  `DATABASE_URL`, or to a connection string that resolves to the same
  host+port+database (even with different credentials or query
  parameters) — the guard rejects both cases explicitly.
- Never run `npm run db:seed` (which deletes and repopulates every
  table) against a database that isn't a disposable local/demo
  database. It already refuses to run when `NODE_ENV=production` unless
  `DEMO_SEED=true` is explicitly set — **never set `DEMO_SEED=true` in
  any environment that holds real pilot data.**
- Never run `npm run db:migrate:deploy` (`prisma migrate deploy`)
  against production as part of a test cycle — that command is reserved
  for the real, intentional production deploy process documented in
  `docs/DEPLOYMENT.md`, not for test-environment setup.
- Never run `npm run test:integration` without `TEST_DATABASE_URL` set
  to a guard-passing value — it applies migrations and creates/deletes
  rows (all scoped to its own tracked test data, but still real writes)
  against whatever database it resolves to.
- Never disable, bypass, or comment out the safety guard
  (`tests/integration/helpers/test-db-guard.ts`) "to make a test run
  faster" — it is the only thing standing between a misconfigured
  environment variable and a destructive operation against the wrong
  database.

## 4. How to run the preflight

```bash
export TEST_DATABASE_URL="postgresql://user:pass@host:5432/pharmacy_duty_scheduler_test"
npm run test:preflight
```

This is **read-only and non-destructive**: it validates
`TEST_DATABASE_URL` against the safety guard, runs a single
`SELECT version()` query, and reports `prisma migrate status` (which
only reports pending migrations — it does not apply them). It never
seeds, truncates, resets, or applies a migration. Run this first, every
time, before any of the commands below — especially before any future
load/backup/restore/resilience test that will run destructive
operations against the target database.

Expected successful output looks like:

```
Target database (sanitized): host:5432/pharmacy_duty_scheduler_test
Safety guard: PASSED (...)
PostgreSQL server version: PostgreSQL 16.x ...
Migration status (informational only — this command applies nothing):
Database schema is up to date!
Preflight complete. No rows were read, written, or deleted; no migration was applied.
```

If it prints `FAIL: TEST_DATABASE_URL failed the safety guard.` followed
by a reason, **stop** — do not proceed to any other test command until
the reported issue is fixed. See "Emergency stop" below if you are
unsure why it failed.

## 5. How to run unit tests

```bash
npm test
```

This never touches any real database — every unit test mocks
`@/lib/prisma`. `TEST_DATABASE_URL`/`DATABASE_URL` do not need to be set
for this command (though having a valid `DATABASE_URL` set is harmless,
since it's never read by the mocked test suite).

## 6. How to run integration tests

```bash
export TEST_DATABASE_URL="postgresql://user:pass@host:5432/pharmacy_duty_scheduler_test"
npm run test:preflight        # confirm the target first
npm run test:integration
```

This runs the real, unmocked application code (Server Actions,
transactions, unique-constraint races) against the real database
`TEST_DATABASE_URL` points at. It applies migrations to that database
(via `globalSetup`) and creates/deletes rows scoped to each test's own
tracked ids (via `afterEach` cleanup) — see
`docs/security/19-test-gap-assertion-quality.md` for the full
architecture. It never touches `DATABASE_URL` directly and refuses to
run at all if `TEST_DATABASE_URL` fails the safety guard (missing,
same as `DATABASE_URL`, no test marker, production marker present, not
a valid PostgreSQL URL).

## 7. How to verify the target database before any destructive test

Before running **any** future load, backup/restore, or resilience test
that will intentionally stress or mutate a database:

1. Run `npm run test:preflight` and read its output in full.
2. Confirm the printed `Target database (sanitized): host:port/dbname`
   line names the database you actually intend to test against — not
   just that it passed the guard, but that it's the *specific* database
   you meant to point at (the guard proves "this is plausibly a test
   database," not "this is the exact one you meant").
3. Confirm the printed PostgreSQL server version and migration status
   look as expected for that environment (e.g. a freshly-provisioned
   staging DB should show "Database schema is up to date!" only after
   you've deliberately applied migrations to it once).
4. Only after all of the above, proceed with the destructive test.

## 8. Emergency stop — if the wrong database is detected

If at any point you suspect a test command is about to run, or has run,
against the wrong database (production, a shared demo environment, or
any database holding real pilot data):

1. **Immediately interrupt the running command** (`Ctrl+C` / kill the
   process). Every command in this repository is a single foreground
   process with no background workers to separately stop.
2. **Do not re-run the command with the same environment.** Unset the
   suspect variable first: `unset TEST_DATABASE_URL` (and `DATABASE_URL`
   if that's what was misconfigured), then re-derive the correct value
   from your actual staging/test provisioning record — do not guess or
   reuse a value from shell history.
3. **Check what actually ran**, using the printed output:
   - `test:preflight` never writes, so if it was the only command run,
     no data changes occurred — confirm by re-reading its own output
     (`No rows were read, written, or deleted; no migration was
     applied.`).
   - `test:integration` only ever mutates rows it created itself
     (tracked by id, cleaned up in `afterEach`) and only ever applies
     Prisma migrations (no destructive `DROP`/`TRUNCATE` is ever
     generated by this project's migration history — confirm by
     reading `prisma/migrations/*/migration.sql` for the specific
     migration(s) applied). If it ran against a database that turns out
     to have held real (non-test) data, treat this as a real incident:
     do not attempt to "clean up" by guessing which rows are safe to
     delete.
   - `npm run db:seed` is the one command that unconditionally deletes
     every row in every table (its safety check only blocks
     `NODE_ENV=production` without `DEMO_SEED=true` — it does not
     otherwise ask "are you sure"). If this was run against the wrong
     database, all data in it is gone; the only recovery path is
     restoring from the target database's own backup, if one exists.
4. **Restore from backup** if any destructive command (`db:seed`, a
   migration with data loss, or a future load/backup-restore test) ran
   against a database holding real or otherwise-needed data, using that
   database's own backup/restore procedure (outside the scope of this
   document — this is a staging/production infrastructure concern, not
   something this repository's test tooling can undo).
5. **Fix the root cause before resuming any testing**: identify exactly
   which environment variable held the wrong value and why (a copy-paste
   error, a shared `.env` file, a misconfigured CI secret), correct it,
   then re-run `npm run test:preflight` and manually re-verify its
   printed `Target database` line before touching any other test
   command again.

## Reference: safety guard rules (enforced in code)

`tests/integration/helpers/test-db-guard.ts`'s `resolveTestDatabaseUrl()`
is the single function every command above depends on. It fails fast
(throws before any connection is opened, any migration is applied, or
any row is touched) unless **all** of the following hold:

1. `TEST_DATABASE_URL` is set — no fallback to `DATABASE_URL` exists
   anywhere in this codebase.
2. `TEST_DATABASE_URL` is a valid, parseable `postgresql://`/`postgres://`
   URL — a `file:`/SQLite URL or an unparseable string is rejected.
3. `TEST_DATABASE_URL` is not byte-identical to `DATABASE_URL`, and does
   not resolve to the same protocol+host+port+database path as
   `DATABASE_URL` even with different credentials/query parameters.
4. The database name contains a recognized test marker (`test`,
   `testing`, or `integration`), case-insensitive.
5. Neither the hostname nor the database name contains a
   production-sounding marker (`prod`, `production`, `live`) —
   evaluated even when a test marker is also present, and this check
   always wins over rule 4.

No part of the connection string (which may embed credentials or
query-string secrets) is ever logged or included in any thrown error —
only the sanitized `host:port/database` identifier
(`sanitizedDatabaseIdentifier()`), which contains no secret.
