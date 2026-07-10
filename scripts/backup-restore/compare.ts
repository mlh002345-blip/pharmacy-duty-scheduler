// Pure comparison helpers used by verify-restored-db.ts. Kept separate
// from the DB-querying script so the comparison LOGIC (not the live
// queries) is directly unit-testable without a real database — see
// scripts/backup-restore/compare.test.ts.

export type Mismatch = { check: string; detail: string };

export function compareRowCount(
  table: string,
  sourceCount: number,
  restoredCount: number
): Mismatch | null {
  if (sourceCount === restoredCount) return null;
  return {
    check: `row count: ${table}`,
    detail: `source=${sourceCount} restored=${restoredCount}`,
  };
}

export function compareOrphanCount(label: string, orphanCount: number): Mismatch | null {
  if (orphanCount === 0) return null;
  return { check: label, detail: `${orphanCount} orphaned row(s) found` };
}

export function compareUniqueIndexPresence(
  indexName: string,
  present: boolean
): Mismatch | null {
  if (present) return null;
  return { check: `unique index: ${indexName}`, detail: "not found on restored database" };
}

export function compareMigrationHistory(
  sourceMigrations: string[],
  restoredMigrations: string[]
): Mismatch | null {
  const match =
    sourceMigrations.length === restoredMigrations.length &&
    sourceMigrations.every((name, i) => name === restoredMigrations[i]);
  if (match) return null;
  return {
    check: "migration history",
    detail: `source has [${sourceMigrations.join(", ")}], restored has [${restoredMigrations.join(", ")}]`,
  };
}

export function compareChecksum(
  label: string,
  sourceChecksum: string,
  restoredChecksum: string
): Mismatch | null {
  if (sourceChecksum === restoredChecksum) return null;
  return { check: `checksum: ${label}`, detail: "source and restored checksums differ" };
}
