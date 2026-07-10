import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { sha256File, writeChecksumFile, writeManifest, type BackupManifest } from "./manifest";

let tmpDir: string | undefined;

afterEach(() => {
  if (tmpDir) {
    rmSync(tmpDir, { recursive: true, force: true });
    tmpDir = undefined;
  }
});

function makeManifest(overrides: Partial<BackupManifest> = {}): BackupManifest {
  return {
    sourceIdentifier: "db.internal:5432/pharmacy_duty_scheduler",
    dumpStartedAt: "2026-07-10T12:00:00.000Z",
    dumpFinishedAt: "2026-07-10T12:00:05.000Z",
    postgresVersion: "PostgreSQL 16.13 on x86_64-pc-linux-gnu",
    format: "custom",
    fileSizeBytes: 12345,
    sha256: "a".repeat(64),
    ...overrides,
  };
}

describe("writeManifest", () => {
  it("writes exactly the five required fields plus format, no extra keys", () => {
    tmpDir = mkdtempSync(join(tmpdir(), "manifest-test-"));
    const dumpPath = join(tmpDir, "backup.dump");
    const manifestPath = writeManifest(dumpPath, makeManifest());

    const parsed = JSON.parse(readFileSync(manifestPath, "utf-8"));
    expect(Object.keys(parsed).sort()).toEqual(
      [
        "sourceIdentifier",
        "dumpStartedAt",
        "dumpFinishedAt",
        "postgresVersion",
        "format",
        "fileSizeBytes",
        "sha256",
      ].sort()
    );
  });

  it("never contains a password, credential-shaped substring, or full connection URL", () => {
    tmpDir = mkdtempSync(join(tmpdir(), "manifest-test-"));
    const dumpPath = join(tmpDir, "backup.dump");
    const manifestPath = writeManifest(
      dumpPath,
      makeManifest({ sourceIdentifier: "db.internal:5432/pharmacy_duty_scheduler" })
    );

    const raw = readFileSync(manifestPath, "utf-8");
    expect(raw).not.toContain("postgresql://");
    expect(raw).not.toContain("postgres://");
    expect(raw).not.toContain("@"); // no user:pass@host shape anywhere
  });

  it("the sourceIdentifier field only ever contains a sanitized host/database, matching the guard's own format", () => {
    tmpDir = mkdtempSync(join(tmpdir(), "manifest-test-"));
    const dumpPath = join(tmpDir, "backup.dump");
    const manifestPath = writeManifest(dumpPath, makeManifest());

    const parsed = JSON.parse(readFileSync(manifestPath, "utf-8"));
    expect(parsed.sourceIdentifier).toMatch(/^[a-zA-Z0-9.-]+:\d+\/[a-zA-Z0-9_.-]+$/);
  });
});

describe("writeChecksumFile", () => {
  it("writes the standard sha256sum-compatible format: '<hex>  <filename>'", () => {
    tmpDir = mkdtempSync(join(tmpdir(), "manifest-test-"));
    const dumpPath = join(tmpDir, "backup.dump");
    const sha = "b".repeat(64);
    const checksumPath = writeChecksumFile(dumpPath, sha);

    const raw = readFileSync(checksumPath, "utf-8");
    expect(raw).toBe(`${sha}  backup.dump\n`);
  });
});

describe("sha256File", () => {
  it("computes the correct digest by streaming the file", async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "manifest-test-"));
    const filePath = join(tmpDir, "sample.txt");
    writeFileSync(filePath, "hello world", "utf-8");

    const digest = await sha256File(filePath);
    // Known SHA-256 of the literal string "hello world".
    expect(digest).toBe("b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9");
  });
});
