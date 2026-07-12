import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// Cleanup only ever needs the top-level "parent" ids — every other
// generated row (HistoricalDutyRecord, DutyAssignment, DutyRequest,
// Unavailability, DutyBalanceAdjustment, AuditLog) is deleted by
// filtering on these parent ids (regionId/pharmacyId/userId/batchId),
// never by tracking every individual child row id — that would make the
// manifest file itself scale with the full dataset size for no benefit.
export type PerfManifest = {
  runId: string;
  marker: string; // e.g. "PERF-<runId>" — prefixed into every generated row's identifying text field
  profile: "quick" | "full";
  createdAt: string;
  organizationId: string;
  regionIds: string[];
  pharmacyIds: string[];
  userIds: string[];
  historicalBatchIds: string[];
  sessionTokenPrefix: string;
  loginAttemptBucketKeyPrefix: string;
  // LoginAttempt.bucketKey is a one-way SHA-256 digest (see
  // hash-identifier.ts) so it cannot be prefix-filtered in SQL the way
  // Session.token can — the plain ids are tracked explicitly instead.
  // The target row count is small (<= a few thousand) so this stays cheap.
  loginAttemptIds: string[];
};

export const BENCHMARK_OUTPUT_DIR = join(process.cwd(), "benchmark-output");

export function manifestPath(runId: string): string {
  return join(BENCHMARK_OUTPUT_DIR, `perf-manifest-${runId}.json`);
}

export function writeManifest(manifest: PerfManifest): string {
  if (!existsSync(BENCHMARK_OUTPUT_DIR)) mkdirSync(BENCHMARK_OUTPUT_DIR, { recursive: true });
  const path = manifestPath(manifest.runId);
  writeFileSync(path, JSON.stringify(manifest, null, 2) + "\n", "utf-8");
  return path;
}

export function readManifest(runId: string): PerfManifest {
  const path = manifestPath(runId);
  if (!existsSync(path)) {
    throw new Error(`No perf manifest found for run "${runId}" at ${path}.`);
  }
  return JSON.parse(readFileSync(path, "utf-8")) as PerfManifest;
}

// Pure guard used by cleanup.ts before issuing any delete — refuses to
// run against a manifest that isn't clearly marked as a benchmark run, or
// that tracks no parent ids (which would make every subsequent
// `where: { id: { in: [] } }` a no-op that looks successful without
// actually proving the run is scoped correctly).
export function validateManifestForCleanup(manifest: PerfManifest | null): { ok: true } | { ok: false; reason: string } {
  if (!manifest) return { ok: false, reason: "No perf manifest found." };
  if (!manifest.marker || !manifest.marker.startsWith("PERF-")) {
    return { ok: false, reason: 'Manifest has no valid "PERF-" marker.' };
  }
  const hasAnyParentIds =
    manifest.regionIds.length > 0 ||
    manifest.pharmacyIds.length > 0 ||
    manifest.userIds.length > 0 ||
    manifest.historicalBatchIds.length > 0;
  if (!hasAnyParentIds) {
    return { ok: false, reason: "Manifest has no tracked parent ids." };
  }
  return { ok: true };
}

/** Finds the most recently written manifest, for `npm run test:perf:*` commands that don't take an explicit runId. */
export function findLatestManifest(): PerfManifest | null {
  if (!existsSync(BENCHMARK_OUTPUT_DIR)) return null;
  const files = readdirSync(BENCHMARK_OUTPUT_DIR).filter(
    (name) => name.startsWith("perf-manifest-") && name.endsWith(".json")
  );
  if (files.length === 0) return null;
  const withMtime = files.map((name) => ({
    name,
    mtime: statSync(join(BENCHMARK_OUTPUT_DIR, name)).mtimeMs,
  }));
  withMtime.sort((a, b) => b.mtime - a.mtime);
  return JSON.parse(readFileSync(join(BENCHMARK_OUTPUT_DIR, withMtime[0].name), "utf-8")) as PerfManifest;
}
