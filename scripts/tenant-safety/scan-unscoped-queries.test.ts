import { describe, expect, it } from "vitest";

import { scanUnscopedTenantQueries } from "./scan-unscoped-queries";

// Completion-gate check for Multi-Tenancy Chunk 1: every tenant-owned
// Prisma call in src/ must either carry an organizationId-reaching filter
// nearby, or be explicitly reviewed and justified in this scanner's
// ALLOWLIST. A new finding here means a newly-written query is missing
// tenant scoping — fix the query, don't add it to the allowlist unless the
// boundary is genuinely enforced some other way at that exact call site.
describe("tenant-safety: no unscoped tenant-owned Prisma calls", () => {
  it("finds zero unreviewed unscoped calls across src/", async () => {
    const findings = await scanUnscopedTenantQueries();
    if (findings.length > 0) {
      const details = findings.map((f) => `  ${f.file}:${f.line}  ${f.snippet}`).join("\n");
      throw new Error(`${findings.length} unscoped tenant-owned Prisma call(s):\n${details}`);
    }
    expect(findings).toHaveLength(0);
  });
});
