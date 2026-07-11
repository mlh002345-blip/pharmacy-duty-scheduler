import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  test: {
    // Real-Postgres integration tests (*.integration.test.ts) live under
    // tests/integration and run only via `npm run test:integration`
    // (vitest.integration.config.ts) — never as part of the normal, fast,
    // fully-mocked `npm test` run. Plain *.test.ts files under
    // tests/integration/helpers/ (e.g. the safety-guard's own unit tests,
    // which are pure/sync and touch no database) are NOT excluded, so
    // they run as part of the normal suite like any other unit test.
    // Real-browser Playwright E2E tests (tests/e2e/specs/*.spec.ts) run
    // only via `npm run test:e2e` (playwright.config.ts) — never as part
    // of `npm test`, and never launch a browser under vitest (they use
    // @playwright/test's own `test`/`expect`, incompatible with vitest's).
    // Real-PostgreSQL chaos/resilience tests (tests/chaos/specs/*.chaos.test.ts)
    // run only via `npm run test:chaos` (vitest.chaos.config.ts) — they
    // inject real faults (stopping the local PostgreSQL service,
    // terminating backends) and must never run as part of the normal,
    // fast, fully-mocked `npm test`.
    // Excel/XLSX file-security tests (tests/file-security/specs/*.filesec.test.ts)
    // run only via `npm run test:file` (vitest.file-security.config.ts) —
    // they parse real (including deliberately malicious/oversized)
    // workbooks against FILE_TEST_DATABASE_URL and must never run as
    // part of the normal, fast, fully-mocked `npm test`.
    exclude: [
      "node_modules/**",
      "tests/integration/**/*.integration.test.ts",
      "tests/e2e/**",
      "tests/chaos/**",
      "tests/file-security/**",
    ],
  },
});
