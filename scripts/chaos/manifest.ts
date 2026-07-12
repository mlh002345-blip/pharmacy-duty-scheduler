import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// Mirrors scripts/perf/manifest.ts's design: only top-level "parent" ids
// are tracked (regions/pharmacies/users/historical-import-batches);
// every row a chaos scenario creates carries a `CHAOS-<runId>-` text
// marker in its identifying field, so cleanup can delete exactly (and
// only) what one run created without needing to track every child row.
export type ChaosManifest = {
  runId: string;
  marker: string; // e.g. "CHAOS-<runId>"
  createdAt: string;
  organizationIds: string[];
  regionIds: string[];
  pharmacyIds: string[];
  userIds: string[];
  historicalBatchIds: string[];
  sessionTokenPrefix: string;
};

export const CHAOS_OUTPUT_DIR = join(process.cwd(), "chaos-output");

export function manifestPath(runId: string): string {
  return join(CHAOS_OUTPUT_DIR, `chaos-manifest-${runId}.json`);
}

export function writeManifest(manifest: ChaosManifest): string {
  if (!existsSync(CHAOS_OUTPUT_DIR)) mkdirSync(CHAOS_OUTPUT_DIR, { recursive: true });
  const path = manifestPath(manifest.runId);
  writeFileSync(path, JSON.stringify(manifest, null, 2) + "\n", "utf-8");
  return path;
}

export function readManifest(runId: string): ChaosManifest {
  const path = manifestPath(runId);
  if (!existsSync(path)) {
    throw new Error(`No chaos manifest found for run "${runId}" at ${path}.`);
  }
  return JSON.parse(readFileSync(path, "utf-8")) as ChaosManifest;
}

export function findLatestManifest(): ChaosManifest | null {
  if (!existsSync(CHAOS_OUTPUT_DIR)) return null;
  const files = readdirSync(CHAOS_OUTPUT_DIR).filter(
    (name) => name.startsWith("chaos-manifest-") && name.endsWith(".json")
  );
  if (files.length === 0) return null;
  const withMtime = files.map((name) => ({
    name,
    mtime: statSync(join(CHAOS_OUTPUT_DIR, name)).mtimeMs,
  }));
  withMtime.sort((a, b) => b.mtime - a.mtime);
  return JSON.parse(readFileSync(join(CHAOS_OUTPUT_DIR, withMtime[0].name), "utf-8")) as ChaosManifest;
}

/** Every manifest listed, newest first — used to clean up all leftover runs, not just the latest. */
export function findAllManifests(): ChaosManifest[] {
  if (!existsSync(CHAOS_OUTPUT_DIR)) return [];
  const files = readdirSync(CHAOS_OUTPUT_DIR).filter(
    (name) => name.startsWith("chaos-manifest-") && name.endsWith(".json")
  );
  const withMtime = files.map((name) => ({
    name,
    mtime: statSync(join(CHAOS_OUTPUT_DIR, name)).mtimeMs,
  }));
  withMtime.sort((a, b) => b.mtime - a.mtime);
  return withMtime.map(
    (f) => JSON.parse(readFileSync(join(CHAOS_OUTPUT_DIR, f.name), "utf-8")) as ChaosManifest
  );
}

export function validateManifestForCleanup(
  manifest: ChaosManifest | null
): { ok: true } | { ok: false; reason: string } {
  if (!manifest) return { ok: false, reason: "No chaos manifest found." };
  if (!manifest.marker || !manifest.marker.startsWith("CHAOS-")) {
    return { ok: false, reason: 'Manifest has no valid "CHAOS-" marker.' };
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
