import { describe, expect, it } from "vitest";

import { validateManifestForCleanup, type ChaosManifest } from "./manifest";

function baseManifest(overrides: Partial<ChaosManifest> = {}): ChaosManifest {
  return {
    runId: "abc123",
    marker: "CHAOS-abc123",
    createdAt: new Date().toISOString(),
    organizationIds: ["org1"],
    regionIds: ["r1"],
    pharmacyIds: ["p1"],
    userIds: ["u1"],
    historicalBatchIds: ["b1"],
    sessionTokenPrefix: "CHAOS-abc123-session-",
    ...overrides,
  };
}

describe("validateManifestForCleanup (chaos)", () => {
  it("rejects a null manifest", () => {
    expect(validateManifestForCleanup(null).ok).toBe(false);
  });

  it("rejects a manifest without a CHAOS- marker", () => {
    expect(validateManifestForCleanup(baseManifest({ marker: "not-a-chaos-run" })).ok).toBe(false);
  });

  it("rejects a manifest with an empty marker", () => {
    expect(validateManifestForCleanup(baseManifest({ marker: "" })).ok).toBe(false);
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
