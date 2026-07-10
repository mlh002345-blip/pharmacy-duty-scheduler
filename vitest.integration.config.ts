import path from "node:path";
import { defineConfig } from "vitest/config";

// Real-PostgreSQL integration tests. Kept in a completely separate Vitest
// project from vitest.config.ts (the default `npm test`) so that:
//   - normal `npm test` never touches a real database and stays fast;
//   - this suite only runs when explicitly invoked via
//     `npm run test:integration`, with its own globalSetup (migrations)
//     and setupFiles (safety guard + the two Next.js runtime mocks).
// fileParallelism is disabled so scenario files run strictly sequentially
// against the shared test database — required for deterministic cleanup
// and to avoid unrelated tests racing each other's concurrency scenarios.
// Within a single file, tests still run sequentially by default (Vitest's
// normal per-file behavior), which is what the deliberate concurrency in
// each scenario (via the gate helper) needs to be reproducible.
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  test: {
    include: ["tests/integration/**/*.integration.test.ts"],
    globalSetup: ["tests/integration/helpers/global-setup.ts"],
    setupFiles: ["tests/integration/helpers/setup.ts"],
    pool: "forks",
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
