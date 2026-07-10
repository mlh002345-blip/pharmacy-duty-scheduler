import { execFileSync } from "node:child_process";

import { resolveTestDatabaseUrl } from "./test-db-guard";

// Vitest `globalSetup`: runs exactly once, in a separate process, before
// any integration test file loads. Its only job is to fail fast if
// TEST_DATABASE_URL isn't safe (see test-db-guard.ts) and to apply Prisma
// migrations to it — the same `prisma migrate deploy` used in production
// deploys, run here against the test database only.
export default async function globalSetup() {
  const testDatabaseUrl = resolveTestDatabaseUrl();

  execFileSync("npx", ["prisma", "migrate", "deploy"], {
    env: { ...process.env, DATABASE_URL: testDatabaseUrl },
    stdio: "inherit",
  });
}
