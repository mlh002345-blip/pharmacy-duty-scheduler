// Safety guard for real-Postgres integration tests (the
// `test:preflight` command) and, via `resolveRestoreDatabaseUrl()`, the
// backup-restore rehearsal tooling under scripts/backup-restore/. This
// module is the single place that decides whether it's safe to point the
// app's Prisma client (or pg_restore) at a database and run migrations/
// destructive setup/cleanup/restore against it.
//
// Rules (all fail fast, no silent fallback), shared by both guards below:
//   1. The target env var (TEST_DATABASE_URL / RESTORE_DATABASE_URL) must
//      be set explicitly — there is no fallback to DATABASE_URL. Unset
//      means "don't run".
//   2. It must be a valid, parseable PostgreSQL connection string
//      (postgresql:// or postgres://) — a SQLite/`file:` URL or a
//      malformed string is rejected outright.
//   3. It must not resolve to the same database as DATABASE_URL —
//      checked both as a byte-identical string AND as a same-protocol/
//      host/port/path comparison, so two URLs that differ only by
//      credentials or query string but point at the same server and
//      database are still caught.
//   4. The database name must contain one of the target's recognized
//      markers, case-insensitive — a lightweight but effective guard
//      against a copy-pasted production/demo connection string.
//   5. Neither the hostname nor the database name may contain a known
//      production-sounding marker ("prod", "production", "live") — this
//      is checked even when a recognized marker is also present (e.g.
//      "production_test" is still rejected), and takes priority over
//      rule 4's allowance.
//
// No part of the connection string (which may embed credentials or
// query-string secrets) is ever logged or included in a thrown error —
// only the bare hostname and database name, neither of which is a
// secret, via `sanitizedDatabaseIdentifier()`.

const TEST_MARKER_PATTERN = /test|integration/i;
const RESTORE_MARKER_PATTERN = /test|integration|restore|staging|recovery/i;
const E2E_MARKER_PATTERN = /test|integration|e2e|staging/i;
const PERF_MARKER_PATTERN = /perf|performance|benchmark|load|test|testing|staging/i;
const CHAOS_MARKER_PATTERN = /chaos|resilience|failure|fault|test|testing|staging/i;
const PRODUCTION_MARKER_PATTERN = /prod|production|live/i;

function parseConnectionUrl(value: string, label: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(
      `${label} is not a valid connection URL (failed to parse). Refusing to run.`
    );
  }
  if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") {
    throw new Error(
      `${label} must be a PostgreSQL connection string ("postgresql://" or ` +
        `"postgres://"). Refusing to run against a non-PostgreSQL URL ` +
        `(e.g. a SQLite "file:" URL) — this guard exists specifically to ` +
        "prevent this operation from ever touching a local dev SQLite " +
        "file or a misconfigured connection string."
    );
  }
  return parsed;
}

/** Bare `host/database` identifier — safe to log, never includes credentials or query params. */
export function sanitizedDatabaseIdentifier(url: URL | string): string {
  const parsed = typeof url === "string" ? new URL(url) : url;
  const databaseName = parsed.pathname.replace(/^\//, "") || "(empty)";
  return `${parsed.hostname}:${parsed.port || "5432"}/${databaseName}`;
}

type GuardedUrlConfig = {
  /** Env var holding the target URL, e.g. "TEST_DATABASE_URL". */
  envVarName: string;
  /** What the guard is protecting against, used only in error wording, e.g. "run destructive integration tests". */
  operationDescription: string;
  /** Pattern the database name must match to be accepted. */
  markerPattern: RegExp;
  /** Human-readable list of accepted markers, used only in error wording. */
  markerDescription: string;
  /** Example database name shown in the "no marker" error message. */
  exampleDatabaseName: string;
};

function resolveGuardedDatabaseUrl(config: GuardedUrlConfig): string {
  const { envVarName } = config;
  const targetUrl = process.env[envVarName];
  if (!targetUrl) {
    throw new Error(
      `${envVarName} is not set. Refusing to ${config.operationDescription} without an ` +
        `explicit, dedicated target database. Set ${envVarName} to a PostgreSQL ` +
        `connection string whose database name contains ${config.markerDescription} ` +
        "before running this command."
    );
  }

  const parsed = parseConnectionUrl(targetUrl, envVarName);

  const appDatabaseUrl = process.env.DATABASE_URL;
  if (appDatabaseUrl) {
    if (targetUrl === appDatabaseUrl) {
      throw new Error(
        `${envVarName} must not be the same value as DATABASE_URL. Refusing to ` +
          `${config.operationDescription} against what could be the production or ` +
          "demo database."
      );
    }
    // Two connection strings can differ only by credentials or query
    // parameters (sslmode, schema, etc.) while still pointing at the
    // exact same server and database — that's just as unsafe as a
    // byte-identical string, so compare the parts that actually identify
    // "which database", not the whole string. A malformed DATABASE_URL is
    // not this function's concern (env.ts already validates it in every
    // context that requires it) — the comparison is simply skipped if it
    // can't be parsed as a URL.
    let appParsed: URL | null = null;
    try {
      appParsed = new URL(appDatabaseUrl);
    } catch {
      appParsed = null;
    }
    if (
      appParsed &&
      appParsed.protocol === parsed.protocol &&
      appParsed.hostname.toLowerCase() === parsed.hostname.toLowerCase() &&
      appParsed.port === parsed.port &&
      appParsed.pathname === parsed.pathname
    ) {
      throw new Error(
        `${envVarName} resolves to the same host/port/database as DATABASE_URL ` +
          "(differing only by credentials or query parameters). Refusing to " +
          `${config.operationDescription} against what could be the production or ` +
          "demo database."
      );
    }
  }

  const databaseName = parsed.pathname.replace(/^\//, "");
  if (!databaseName) {
    throw new Error(`${envVarName} has no database name in its path. Refusing to run.`);
  }

  const hostname = parsed.hostname;
  if (PRODUCTION_MARKER_PATTERN.test(hostname) || PRODUCTION_MARKER_PATTERN.test(databaseName)) {
    throw new Error(
      `Refusing to run: "${sanitizedDatabaseIdentifier(parsed)}" looks like a production ` +
        'database (hostname or database name contains "prod"/"production"/"live"). This ' +
        `check takes priority even if the name also contains a recognized marker. Point ` +
        `${envVarName} at a dedicated, clearly-named target database instead.`
    );
  }

  if (!config.markerPattern.test(databaseName)) {
    throw new Error(
      `Refusing to run: the database name "${databaseName}" does not contain ` +
        `${config.markerDescription}. Point ${envVarName} at a database whose name clearly ` +
        `identifies it as such (e.g. "${config.exampleDatabaseName}").`
    );
  }

  return targetUrl;
}

export function resolveTestDatabaseUrl(): string {
  return resolveGuardedDatabaseUrl({
    envVarName: "TEST_DATABASE_URL",
    operationDescription: "run destructive integration tests",
    markerPattern: TEST_MARKER_PATTERN,
    markerDescription: '"test" (or "testing"/"integration")',
    exampleDatabaseName: "pharmacy_duty_scheduler_test",
  });
}

// Used by scripts/backup-restore/*.ts — the restore target additionally
// accepts "restore"/"staging"/"recovery" markers (on top of "test"/
// "testing"/"integration") since a dedicated restore-rehearsal database
// is often named after that purpose rather than "test" specifically.
export function resolveRestoreDatabaseUrl(): string {
  return resolveGuardedDatabaseUrl({
    envVarName: "RESTORE_DATABASE_URL",
    operationDescription: "restore a backup",
    markerPattern: RESTORE_MARKER_PATTERN,
    markerDescription: '"test", "testing", "integration", "restore", "staging", or "recovery"',
    exampleDatabaseName: "pharmacy_duty_scheduler_restore",
  });
}

// Used by tests/e2e/ — the browser E2E database additionally accepts an
// "e2e" marker (on top of "test"/"testing"/"integration"/"staging")
// since that's the most natural name for a dedicated Playwright target.
export function resolveE2EDatabaseUrl(): string {
  return resolveGuardedDatabaseUrl({
    envVarName: "E2E_DATABASE_URL",
    operationDescription: "run browser E2E tests",
    markerPattern: E2E_MARKER_PATTERN,
    markerDescription: '"test", "testing", "integration", "e2e", or "staging"',
    exampleDatabaseName: "pharmacy_duty_scheduler_e2e",
  });
}

// Used by scripts/perf/ — the performance/query-plan benchmark database.
// Accepts a broader marker set since operators may reasonably name it
// after "perf"/"benchmark"/"load" rather than "test".
export function resolvePerfDatabaseUrl(): string {
  return resolveGuardedDatabaseUrl({
    envVarName: "PERF_DATABASE_URL",
    operationDescription: "run performance benchmarks",
    markerPattern: PERF_MARKER_PATTERN,
    markerDescription:
      '"perf", "performance", "benchmark", "load", "test", "testing", or "staging"',
    exampleDatabaseName: "pharmacy_duty_scheduler_perf",
  });
}

// Used by tests/chaos/ and scripts/chaos/ — the PostgreSQL
// failure/latency/connection-pool resilience test database. This target
// is subject to destructive local fault injection (pg_terminate_backend,
// stopping/starting the local PostgreSQL service, ALTER DATABASE
// CONNECTION LIMIT, scoped lock/statement timeouts) — never anything
// this guard would allow to resolve to DATABASE_URL, so a chaos run can
// never accidentally kill production connections or restart a shared
// production service.
export function resolveChaosDatabaseUrl(): string {
  return resolveGuardedDatabaseUrl({
    envVarName: "CHAOS_DATABASE_URL",
    operationDescription: "run database resilience/chaos tests",
    markerPattern: CHAOS_MARKER_PATTERN,
    markerDescription:
      '"chaos", "resilience", "failure", "fault", "test", "testing", or "staging"',
    exampleDatabaseName: "pharmacy_duty_scheduler_chaos",
  });
}

// Called from the per-worker setup file: makes the app's own
// src/lib/prisma.ts (via src/lib/env.ts) resolve to the test database for
// this process only. This never touches the real DATABASE_URL value itself
// — it only ever reads it for the equality safety check above.
export function pointProcessAtTestDatabase(): string {
  const testUrl = resolveTestDatabaseUrl();
  process.env.DATABASE_URL = testUrl;
  return testUrl;
}

// Same as pointProcessAtTestDatabase(), for the chaos-test worker setup
// file — makes the app's own src/lib/prisma.ts resolve to the guarded
// chaos database for this process only.
export function pointProcessAtChaosDatabase(): string {
  const chaosUrl = resolveChaosDatabaseUrl();
  process.env.DATABASE_URL = chaosUrl;
  return chaosUrl;
}
