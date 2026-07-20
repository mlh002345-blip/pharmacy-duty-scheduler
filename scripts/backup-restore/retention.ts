// Pure retention-selection logic for scheduled-backup.ts — kept separate
// and dependency-free (no fs/process access) so it can be exhaustively
// unit-tested without touching a real filesystem.

export type BackupFileInfo = {
  /** The .dump file's base name, e.g. "mydb_2026-07-20T10-00-00-000Z.dump". */
  name: string;
  mtimeMs: number;
};

// Selects which backups to delete: anything older than `retentionDays`,
// EXCEPT the single most recent backup is always kept regardless of age —
// a misconfigured (too-short) retention window, a clock skew, or a long
// gap since the last successful run must never be able to delete every
// backup and leave zero recovery points.
export function selectBackupsToDelete(
  files: BackupFileInfo[],
  retentionDays: number,
  nowMs: number
): string[] {
  if (files.length <= 1) return [];

  const cutoffMs = nowMs - retentionDays * 24 * 60 * 60 * 1000;
  const [, ...rest] = [...files].sort((a, b) => b.mtimeMs - a.mtimeMs);

  return rest.filter((file) => file.mtimeMs < cutoffMs).map((file) => file.name);
}
