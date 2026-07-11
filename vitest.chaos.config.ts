import path from "node:path";
import { defineConfig } from "vitest/config";

// Real-PostgreSQL DB resilience/chaos tests (pre-pilot Step 6). Kept in a
// completely separate Vitest project from vitest.config.ts (the default
// `npm test`) and from vitest.integration.config.ts, so that:
//   - normal `npm test` and `npm run test:integration` never inject a
//     real fault or stop the local PostgreSQL service;
//   - this suite only runs when explicitly invoked via
//     `npm run test:chaos`, with its own globalSetup (guard + migrations)
//     and setupFiles (guard + the same Next.js runtime mocks the
//     integration suite uses, so real Server Actions can be called
//     directly).
// fileParallelism is disabled: scenario files inject real faults against
// the *same* shared local PostgreSQL service (stop/start, backend
// termination, connection-limit changes) — running them concurrently
// would make one file's fault injection corrupt another's in-flight
// scenario. Generous timeouts because some scenarios deliberately wait
// out real connection/lock timeouts.
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  test: {
    include: ["tests/chaos/specs/**/*.chaos.test.ts"],
    globalSetup: ["tests/chaos/helpers/global-setup.ts"],
    setupFiles: ["tests/chaos/helpers/setup.ts"],
    pool: "forks",
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
