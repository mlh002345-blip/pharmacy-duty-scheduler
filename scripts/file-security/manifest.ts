import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// Mirrors scripts/chaos/manifest.ts / scripts/perf/manifest.ts: only
// top-level "parent" ids are tracked; every row a file-security test
// creates carries a `FILETEST-<runId>-` text marker in its identifying
// field, so cleanup can delete exactly (and only) what one run created.
export type FileTestManifest = {
  runId: string;
  marker: string;
  createdAt: string;
  organizationIds: string[];
  regionIds: string[];
  pharmacyIds: string[];
  userIds: string[];
  historicalBatchIds: string[];
};

export const FILE_TEST_OUTPUT_DIR = join(process.cwd(), "file-security-output");

export function manifestPath(runId: string): string {
  return join(FILE_TEST_OUTPUT_DIR, `filetest-manifest-${runId}.json`);
}

export function writeManifest(manifest: FileTestManifest): string {
  if (!existsSync(FILE_TEST_OUTPUT_DIR)) mkdirSync(FILE_TEST_OUTPUT_DIR, { recursive: true });
  const path = manifestPath(manifest.runId);
  writeFileSync(path, JSON.stringify(manifest, null, 2) + "\n", "utf-8");
  return path;
}

export function readManifest(runId: string): FileTestManifest {
  const path = manifestPath(runId);
  if (!existsSync(path)) {
    throw new Error(`No file-security manifest found for run "${runId}" at ${path}.`);
  }
  return JSON.parse(readFileSync(path, "utf-8")) as FileTestManifest;
}

export function findAllManifests(): FileTestManifest[] {
  if (!existsSync(FILE_TEST_OUTPUT_DIR)) return [];
  const files = readdirSync(FILE_TEST_OUTPUT_DIR).filter(
    (name) => name.startsWith("filetest-manifest-") && name.endsWith(".json")
  );
  const withMtime = files.map((name) => ({ name, mtime: statSync(join(FILE_TEST_OUTPUT_DIR, name)).mtimeMs }));
  withMtime.sort((a, b) => b.mtime - a.mtime);
  return withMtime.map(
    (f) => JSON.parse(readFileSync(join(FILE_TEST_OUTPUT_DIR, f.name), "utf-8")) as FileTestManifest
  );
}

export function validateManifestForCleanup(
  manifest: FileTestManifest | null
): { ok: true } | { ok: false; reason: string } {
  if (!manifest) return { ok: false, reason: "No file-security manifest found." };
  if (!manifest.marker || !manifest.marker.startsWith("FILETEST-")) {
    return { ok: false, reason: 'Manifest has no valid "FILETEST-" marker.' };
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
