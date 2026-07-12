import type { Prisma } from "@prisma/client";

// Same read-then-write race admin-guard.ts protects against, one level
// up: "at least one active organization must exist" is checked and
// enforced in two separate steps unless serialized. Two concurrent
// PLATFORM_ADMIN requests deactivating two different (but, at that
// moment, the only two active) organizations could both read "2 active"
// and both proceed, leaving zero. A single global advisory lock key is
// correct here (unlike admin-guard.ts's per-organization key) because
// this rule is evaluated across all organizations, not within one.
const LAST_ACTIVE_ORGANIZATION_LOCK_KEY = "pharmacy-duty-scheduler:last-active-organization";

export class LastActiveOrganizationError extends Error {}

export async function assertLastActiveOrganizationNotDeactivated(
  tx: Prisma.TransactionClient
): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${LAST_ACTIVE_ORGANIZATION_LOCK_KEY}))`;

  const activeOrganizationCount = await tx.organization.count({
    where: { isActive: true },
  });
  if (activeOrganizationCount <= 1) {
    throw new LastActiveOrganizationError(
      "Sistemde en az bir aktif oda bulunmalıdır."
    );
  }
}
