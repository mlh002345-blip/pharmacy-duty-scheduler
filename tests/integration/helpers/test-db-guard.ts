// Safety guard for real-Postgres integration tests. This module is the
// single place that decides whether it's safe to point the app's Prisma
// client at a database and run destructive setup/cleanup against it.
//
// Rules (all fail fast, no silent fallback):
//   1. TEST_DATABASE_URL must be set explicitly — there is no fallback to
//      DATABASE_URL. An unset TEST_DATABASE_URL means "don't run".
//   2. TEST_DATABASE_URL must not be byte-identical to DATABASE_URL (the
//      value the running app/production would use) — refuses to run
//      destructive tests against what could be the same database.
//   3. The database name in TEST_DATABASE_URL must contain "test"
//      (case-insensitive) — a lightweight but effective guard against a
//      copy-pasted production/demo connection string that just happens to
//      differ from DATABASE_URL by an env-var name.
//
// No part of the connection string (which may embed credentials) is ever
// logged — only the bare database name, which is not a secret.
export function resolveTestDatabaseUrl(): string {
  const testUrl = process.env.TEST_DATABASE_URL;
  if (!testUrl) {
    throw new Error(
      "TEST_DATABASE_URL is not set. Integration tests refuse to run without an " +
        "explicit, dedicated test database. Set TEST_DATABASE_URL to a PostgreSQL " +
        "connection string whose database name contains \"test\" before running " +
        "`npm run test:integration`."
    );
  }

  if (testUrl === process.env.DATABASE_URL) {
    throw new Error(
      "TEST_DATABASE_URL must not be the same value as DATABASE_URL. Refusing to " +
        "run destructive integration tests against what could be the production or " +
        "demo database."
    );
  }

  let databaseName: string;
  try {
    databaseName = new URL(testUrl).pathname.replace(/^\//, "");
  } catch {
    throw new Error(
      "TEST_DATABASE_URL is not a valid connection URL (failed to parse). Refusing to run."
    );
  }

  if (!databaseName || !/test/i.test(databaseName)) {
    throw new Error(
      `Refusing to run integration tests: the database name "${databaseName || "(empty)"}" ` +
        'does not contain "test". Point TEST_DATABASE_URL at a database whose name ' +
        'clearly identifies it as a test database (e.g. "pharmacy_duty_scheduler_test").'
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
