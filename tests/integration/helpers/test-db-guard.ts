// Safety guard for real-Postgres integration tests (and the
// `test:preflight` command). This module is the single place that
// decides whether it's safe to point the app's Prisma client at a
// database and run migrations/destructive setup/cleanup against it.
//
// Rules (all fail fast, no silent fallback):
//   1. TEST_DATABASE_URL must be set explicitly — there is no fallback to
//      DATABASE_URL. An unset TEST_DATABASE_URL means "don't run".
//   2. TEST_DATABASE_URL must be a valid, parseable PostgreSQL connection
//      string (postgresql:// or postgres://) — a SQLite/`file:` URL or a
//      malformed string is rejected outright.
//   3. TEST_DATABASE_URL must not resolve to the same database as
//      DATABASE_URL — checked both as a byte-identical string AND as a
//      same-protocol/host/port/path comparison, so two URLs that differ
//      only by credentials or query string but point at the same server
//      and database are still caught.
//   4. The database name in TEST_DATABASE_URL must contain one of the
//      recognized test markers ("test", "testing", "integration") —
//      case-insensitive — a lightweight but effective guard against a
//      copy-pasted production/demo connection string.
//   5. Neither the hostname nor the database name may contain a known
//      production-sounding marker ("prod", "production", "live") — this
//      is checked even when a test marker is also present (e.g.
//      "production_test" is still rejected), and takes priority over
//      rule 4's allowance.
//
// No part of the connection string (which may embed credentials or
// query-string secrets) is ever logged or included in a thrown error —
// only the bare hostname and database name, neither of which is a
// secret, via `sanitizedDatabaseIdentifier()`.

const TEST_MARKER_PATTERN = /test|integration/i;
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
        "prevent integration tests from ever touching a local dev SQLite " +
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

export function resolveTestDatabaseUrl(): string {
  const testUrl = process.env.TEST_DATABASE_URL;
  if (!testUrl) {
    throw new Error(
      "TEST_DATABASE_URL is not set. Integration tests refuse to run without an " +
        "explicit, dedicated test database. Set TEST_DATABASE_URL to a PostgreSQL " +
        "connection string whose database name contains \"test\" (or \"testing\"/" +
        "\"integration\") before running `npm run test:integration` or " +
        "`npm run test:preflight`."
    );
  }

  const parsed = parseConnectionUrl(testUrl, "TEST_DATABASE_URL");

  const appDatabaseUrl = process.env.DATABASE_URL;
  if (appDatabaseUrl) {
    if (testUrl === appDatabaseUrl) {
      throw new Error(
        "TEST_DATABASE_URL must not be the same value as DATABASE_URL. Refusing to " +
          "run destructive integration tests against what could be the production or " +
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
        "TEST_DATABASE_URL resolves to the same host/port/database as DATABASE_URL " +
          "(differing only by credentials or query parameters). Refusing to run " +
          "destructive integration tests against what could be the production or " +
          "demo database."
      );
    }
  }

  const databaseName = parsed.pathname.replace(/^\//, "");
  if (!databaseName) {
    throw new Error(
      "TEST_DATABASE_URL has no database name in its path. Refusing to run."
    );
  }

  const hostname = parsed.hostname;
  if (PRODUCTION_MARKER_PATTERN.test(hostname) || PRODUCTION_MARKER_PATTERN.test(databaseName)) {
    throw new Error(
      `Refusing to run integration tests: "${sanitizedDatabaseIdentifier(parsed)}" looks ` +
        'like a production database (hostname or database name contains "prod"/' +
        '"production"/"live"). This check takes priority even if the name also ' +
        "contains a test marker. Point TEST_DATABASE_URL at a dedicated, clearly-" +
        "named test database instead."
    );
  }

  if (!TEST_MARKER_PATTERN.test(databaseName)) {
    throw new Error(
      `Refusing to run integration tests: the database name "${databaseName}" does not ` +
        'contain a recognized test marker ("test", "testing", or "integration"). Point ' +
        "TEST_DATABASE_URL at a database whose name clearly identifies it as a test " +
        'database (e.g. "pharmacy_duty_scheduler_test").'
    );
  }

  return testUrl;
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
