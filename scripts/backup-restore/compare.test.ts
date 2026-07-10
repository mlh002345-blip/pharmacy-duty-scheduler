import { describe, expect, it } from "vitest";

import {
  compareChecksum,
  compareMigrationHistory,
  compareOrphanCount,
  compareRowCount,
  compareUniqueIndexPresence,
} from "./compare";

describe("compareRowCount", () => {
  it("returns null when counts match", () => {
    expect(compareRowCount("Pharmacy", 100, 100)).toBeNull();
  });

  it("detects a row-count mismatch and reports both values", () => {
    const mismatch = compareRowCount("Pharmacy", 100, 97);
    expect(mismatch).not.toBeNull();
    expect(mismatch?.check).toBe("row count: Pharmacy");
    expect(mismatch?.detail).toContain("source=100");
    expect(mismatch?.detail).toContain("restored=97");
  });

  it("detects a mismatch even when the restored count is higher than the source", () => {
    const mismatch = compareRowCount("AuditLog", 5, 8);
    expect(mismatch).not.toBeNull();
  });

  it("treats zero vs zero as a match, not a mismatch", () => {
    expect(compareRowCount("LoginAttempt", 0, 0)).toBeNull();
  });
});

describe("compareOrphanCount", () => {
  it("returns null when there are zero orphans", () => {
    expect(compareOrphanCount("DutyAssignment -> Pharmacy", 0)).toBeNull();
  });

  it("reports a mismatch when orphaned rows are found", () => {
    const mismatch = compareOrphanCount("DutyAssignment -> Pharmacy", 3);
    expect(mismatch).not.toBeNull();
    expect(mismatch?.detail).toContain("3 orphaned row(s)");
  });
});

describe("compareUniqueIndexPresence", () => {
  it("returns null when the index is present", () => {
    expect(compareUniqueIndexPresence("User_email_key", true)).toBeNull();
  });

  it("reports a mismatch when the index is missing", () => {
    const mismatch = compareUniqueIndexPresence("User_email_key", false);
    expect(mismatch).not.toBeNull();
    expect(mismatch?.check).toBe("unique index: User_email_key");
  });
});

describe("compareMigrationHistory", () => {
  it("returns null when both migration lists are identical", () => {
    expect(compareMigrationHistory(["a", "b", "c"], ["a", "b", "c"])).toBeNull();
  });

  it("detects a mismatch when the restored database is missing a migration", () => {
    const mismatch = compareMigrationHistory(["a", "b", "c"], ["a", "b"]);
    expect(mismatch).not.toBeNull();
    expect(mismatch?.check).toBe("migration history");
  });

  it("detects a mismatch when the order differs", () => {
    expect(compareMigrationHistory(["a", "b"], ["b", "a"])).not.toBeNull();
  });

  it("treats two empty lists as a match", () => {
    expect(compareMigrationHistory([], [])).toBeNull();
  });
});

describe("compareChecksum", () => {
  it("returns null when checksums match", () => {
    expect(compareChecksum("Region", "abc123", "abc123")).toBeNull();
  });

  it("detects a checksum mismatch without leaking the actual checksum values in a way that implies content", () => {
    const mismatch = compareChecksum("Region", "abc123", "def456");
    expect(mismatch).not.toBeNull();
    expect(mismatch?.check).toBe("checksum: Region");
    expect(mismatch?.detail).toBe("source and restored checksums differ");
  });
});
