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
    exclude: [
      "node_modules/**",
      "tests/integration/**/*.integration.test.ts",
      "tests/e2e/**",
    ],
  },
});
