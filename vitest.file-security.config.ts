import path from "node:path";
import { defineConfig } from "vitest/config";

// Excel/XLSX import-export resource/security tests (pre-pilot Step 7).
// Kept in a completely separate Vitest project from vitest.config.ts (the
// default `npm test`) so that normal `npm test` never parses a real
// uploaded workbook or touches FILE_TEST_DATABASE_URL, and this suite
// only runs via `npm run test:file`, with its own globalSetup
// (guard + migrations) and setupFiles (guard + the same Next.js runtime
// mocks the integration/chaos suites use, so real Server Actions can be
// called directly).
//
// fileParallelism is disabled: benchmark tests measure process RSS/heap
// deltas, which would be meaningless if another file's workbook parsing
// ran concurrently in a sibling worker.
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  test: {
    include: ["tests/file-security/specs/**/*.filesec.test.ts"],
    globalSetup: ["tests/file-security/helpers/global-setup.ts"],
    setupFiles: ["tests/file-security/helpers/setup.ts"],
    pool: "forks",
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
