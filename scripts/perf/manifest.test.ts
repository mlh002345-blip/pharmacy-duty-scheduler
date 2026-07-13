import { describe, expect, it } from "vitest";

import { validateManifestForCleanup, type PerfManifest } from "./manifest";

function baseManifest(overrides: Partial<PerfManifest> = {}): PerfManifest {
  return {
    runId: "abc123",
    marker: "PERF-abc123",
    profile: "quick",
    createdAt: new Date().toISOString(),
    organizationId: "org1",
    regionIds: ["r1"],
    pharmacyIds: ["p1"],
    userIds: ["u1"],
    historicalBatchIds: ["b1"],
    sessionTokenPrefix: "PERF-abc123-session-",
    loginAttemptBucketKeyPrefix: "PERF-abc123-bucket-",
    loginAttemptIds: ["l1"],
    ...overrides,
  };
}

describe("validateManifestForCleanup", () => {
  it("rejects a null manifest", () => {
    const result = validateManifestForCleanup(null);
    expect(result.ok).toBe(false);
  });

  it("rejects a manifest without a PERF- marker", () => {
    const result = validateManifestForCleanup(baseManifest({ marker: "not-a-perf-run" }));
    expect(result.ok).toBe(false);
  });

  it("rejects a manifest with an empty marker", () => {
    const result = validateManifestForCleanup(baseManifest({ marker: "" }));
    expect(result.ok).toBe(false);
  });

  it("rejects a manifest that tracks no parent ids at all", () => {
    const result = validateManifestForCleanup(
      baseManifest({ regionIds: [], pharmacyIds: [], userIds: [], historicalBatchIds: [] })
    );
    expect(result.ok).toBe(false);
  });

  it("accepts a properly marked manifest with at least one tracked parent id", () => {
    const result = validateManifestForCleanup(
      baseManifest({ regionIds: [], pharmacyIds: [], userIds: ["u1"], historicalBatchIds: [] })
    );
    expect(result.ok).toBe(true);
  });

  it("accepts a fully populated manifest", () => {
    expect(validateManifestForCleanup(baseManifest()).ok).toBe(true);
  });
});
