import { execFileSync } from "node:child_process";

import { resolveChaosDatabaseUrl } from "../../integration/helpers/test-db-guard";
import { startLocalPostgresService, waitForChaosDatabase } from "../../../scripts/chaos/fault-control";

// Vitest `globalSetup`: runs exactly once, before any chaos spec file
// loads. Fails fast if CHAOS_DATABASE_URL isn't safe, makes sure the
// local PostgreSQL service is actually up (a previous crashed run could
// have left it stopped mid-scenario), then applies migrations to the
// chaos database only.
export default async function globalSetup() {
  const chaosDatabaseUrl = resolveChaosDatabaseUrl();

  const probe = await waitForChaosDatabase({ up: true, timeoutMs: 2_000, pollIntervalMs: 500 });
  if (!probe.reachedTargetState) {
    console.log("[chaos:global-setup] Local PostgreSQL service appears down — starting it.");
    startLocalPostgresService();
    const started = await waitForChaosDatabase({ up: true, timeoutMs: 15_000 });
    if (!started.reachedTargetState) {
      throw new Error("Local PostgreSQL service did not come up before chaos suite global setup.");
    }
  }

  execFileSync("npx", ["prisma", "migrate", "deploy"], {
    env: { ...process.env, DATABASE_URL: chaosDatabaseUrl },
    stdio: "inherit",
  });

  // Built once, here, for the whole suite — HTTP-level scenarios (A, C,
  // F, login-outage) each only need to run `next start` against this
  // same build, which is fast, rather than rebuilding per scenario file.
  console.log("[chaos:global-setup] Building production app for HTTP-level scenarios...");
  execFileSync("npm", ["run", "build"], {
    env: { ...process.env, DATABASE_URL: chaosDatabaseUrl, NODE_ENV: "production" },
    stdio: "inherit",
  });
}
