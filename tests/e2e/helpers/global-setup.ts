import { execFileSync } from "node:child_process";

import { resolveE2EDatabaseUrl } from "../../integration/helpers/test-db-guard";

// Playwright global setup: runs exactly once, before any browser or the
// webServer is started. Its only job is to fail fast if E2E_DATABASE_URL
// isn't safe (see tests/integration/helpers/test-db-guard.ts) and to
// apply Prisma migrations to it — the same `prisma migrate deploy` used
// in production deploys, run here against the E2E database only, never
// DATABASE_URL. No seed is ever run.
export default async function globalSetup() {
  const e2eDatabaseUrl = resolveE2EDatabaseUrl();

  execFileSync("npx", ["prisma", "migrate", "deploy"], {
    env: { ...process.env, DATABASE_URL: e2eDatabaseUrl },
    stdio: "inherit",
  });
}
