import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  test: {
    // Real-Postgres integration tests live under tests/integration and run
    // only via `npm run test:integration` (vitest.integration.config.ts) —
    // never as part of the normal, fast, fully-mocked `npm test` run.
    exclude: ["node_modules/**", "tests/integration/**"],
  },
});
