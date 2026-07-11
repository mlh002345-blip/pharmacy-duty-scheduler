// Pure (no I/O, no env reads) fault-injection target validation — kept
// separate from fault-control.ts so it can be unit-tested without
// requiring CHAOS_DATABASE_URL to be set (fault-control.ts itself
// resolves the guarded URL at import time via scripts/chaos/db.ts).

const CHAOS_MARKER_PATTERN = /chaos|resilience|failure|fault|test|testing|staging/i;

export function validateFaultTarget(
  databaseName: string,
  expectedDatabaseName: string
): { ok: true } | { ok: false; reason: string } {
  if (databaseName !== expectedDatabaseName) {
    return {
      ok: false,
      reason: `target database "${databaseName}" does not match the guarded CHAOS_DATABASE_URL database ("${expectedDatabaseName}").`,
    };
  }
  if (!CHAOS_MARKER_PATTERN.test(databaseName)) {
    return { ok: false, reason: `"${databaseName}" does not carry a recognized chaos-test marker.` };
  }
  return { ok: true };
}
