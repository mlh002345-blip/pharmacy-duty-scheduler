import { defineConfig } from "@playwright/test";

import { resolveE2EDatabaseUrl } from "./tests/integration/helpers/test-db-guard";

// Real-browser E2E tests (role/session security — pre-pilot Step 4).
// Deliberately separate from vitest.config.ts/vitest.integration.config.ts
// — `npm test` never launches a browser or Playwright, and this suite
// only runs via the explicit `npm run test:e2e` command.
//
// The app under test runs as a real, separately-built production server
// (`next build && next start`, not `next dev`) bound to `localhost` —
// Chromium treats `http://localhost` as a secure context even without
// real TLS, so the session cookie's `Secure` attribute (which the app
// only sets when NODE_ENV=production, see src/lib/auth/session.ts) can
// be genuinely exercised locally, not just asserted by reading the
// cookie's declared flag. This does NOT prove real HTTPS termination
// behavior on Railway — see docs/testing/ROLE_SESSION_E2E_TESTS.md for
// what still requires a live, deployed check.
const E2E_PORT = 3210;
const E2E_BASE_URL = `http://localhost:${E2E_PORT}`;

// Resolved (and guard-checked — throws before anything else runs if
// unsafe) once, at config-load time, so both the webServer's env and
// every spec file's own Prisma connection (tests/e2e/helpers/db.ts) are
// guaranteed to agree on exactly the same guarded database.
const e2eDatabaseUrl = resolveE2EDatabaseUrl();

export default defineConfig({
  testDir: "./tests/e2e/specs",
  timeout: 30_000,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  globalSetup: "./tests/e2e/helpers/global-setup.ts",
  use: {
    baseURL: E2E_BASE_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    launchOptions: {
      // See /root/.ccr/README.md-equivalent environment note: this
      // session's Chromium is pre-installed outside the default
      // Playwright cache path.
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || "/opt/pw-browsers/chromium",
    },
  },
  projects: [
    {
      name: "chromium",
      use: {},
    },
  ],
  webServer: {
    // Production build + start (not `next dev`) — see comment above for
    // why. `reuseExistingServer: false` makes Playwright fail fast if
    // E2E_PORT is already occupied by something else, rather than
    // silently reusing an unrelated process.
    command: `npm run build && npm run start -- -p ${E2E_PORT}`,
    url: E2E_BASE_URL,
    reuseExistingServer: false,
    timeout: 180_000,
    env: {
      ...process.env,
      DATABASE_URL: e2eDatabaseUrl,
      NODE_ENV: "production",
    },
  },
});
