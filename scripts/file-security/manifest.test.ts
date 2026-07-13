import { describe, expect, it } from "vitest";

import { validateManifestForCleanup, type FileTestManifest } from "./manifest";

function baseManifest(overrides: Partial<FileTestManifest> = {}): FileTestManifest {
  return {
    runId: "abc123",
    marker: "FILETEST-abc123",
    createdAt: new Date().toISOString(),
    organizationIds: ["org1"],
    regionIds: ["r1"],
    pharmacyIds: ["p1"],
    userIds: ["u1"],
    historicalBatchIds: ["b1"],
    ...overrides,
  };
}

describe("validateManifestForCleanup (file-security)", () => {
  it("rejects a null manifest", () => {
    expect(validateManifestForCleanup(null).ok).toBe(false);
  });

  it("rejects a manifest without a FILETEST- marker", () => {
    expect(validateManifestForCleanup(baseManifest({ marker: "not-a-filetest-run" })).ok).toBe(false);
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
