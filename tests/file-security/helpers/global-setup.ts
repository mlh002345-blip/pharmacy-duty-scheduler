import { execFileSync } from "node:child_process";

import { resolveFileTestDatabaseUrl } from "../../integration/helpers/test-db-guard";

// Vitest `globalSetup`: runs exactly once, before any file-security spec
// file loads. Fails fast if FILE_TEST_DATABASE_URL isn't safe, then
// applies migrations to that database only.
export default async function globalSetup() {
  const fileTestDatabaseUrl = resolveFileTestDatabaseUrl();

  execFileSync("npx", ["prisma", "migrate", "deploy"], {
    env: { ...process.env, DATABASE_URL: fileTestDatabaseUrl },
    stdio: "inherit",
  });
}
