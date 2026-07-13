# Multi-Tenancy Production Deployment

Exact operator procedure for the **first** production deploy of
`feature/multi-tenancy-pharmacy-import`. Supersedes the
"Before deploy"/"Deploy"/rollback sections of
`docs/operations/PILOT_DEPLOYMENT_CHECKLIST.md` for this specific
deploy only; the general Railway mechanics and demo-account smoke-test
pattern in that document still apply.

## Backup requirement

**A full production database backup is mandatory before this deploy**,
regardless of how many times the migration has been rehearsed
elsewhere. This migration is destructive-adjacent (adds `NOT NULL`
columns and new unique constraints after a single-transaction backfill —
see `docs/architecture/MULTI_TENANCY.md`); a `DB restore` is the only
undo path if it must be reversed after commit (see "Rollback decision
tree" below).

Take the backup per `docs/testing/BACKUP_RESTORE_REHEARSAL.md`
(`npm run db:backup:production` or Railway's own managed backup) and
confirm it completed successfully **before** proceeding. Do not start
the migration on an unconfirmed or in-progress backup.

## Current production commit

At the time this document was written, `origin/main` is at `8455db8`
("Add hosted deployment readiness: env templates, PostgreSQL guide, seed
safety guard") and `origin/deploy/postgresql-demo` (the actively
deployed pilot branch) is at `00a0979` ("Record live Railway evidence
and update pilot decision to GO") — **single-tenant**, pre-dates this
entire multi-tenancy feature. Re-confirm both hashes immediately before
deploying (`git rev-parse origin/main origin/deploy/postgresql-demo`) —
do not trust this document's snapshot if time has passed since it was
written.

## Feature commit chain

On `feature/multi-tenancy-pharmacy-import`, based on `00a0979`:

1. `53b6740` — multi-tenancy foundation: `Organization` model, the one
   atomic migration, `PLATFORM_ADMIN` role, tenant guard helpers.
2. `0c77259` — complete tenant-isolation sweep (every tenant-owned
   Prisma call site converted).
3. `546e727` — Multi-Tenancy Stabilization Gate (full regression proof
   the tenant-scoping conversion broke nothing).
4. `f839245` — Platform Administration and Organization Onboarding.
5. `e755a79` — generic ADMIN-only Pharmacy Excel Import.
6. Final acceptance-gate documentation/verification commit (this
   document's own commit — see the session's final report for its exact
   hash).

Deploy this exact chain in order — it is one linear branch, so a normal
merge/deploy of the branch tip carries all six automatically. Do not
cherry-pick a subset.

## Environment variables

No new required environment variable is introduced by this feature —
`Organization`/`PharmacyImportBatch`/etc. are ordinary tables reached
through the existing `DATABASE_URL`. Re-confirm the existing pilot
checklist's environment checks still hold:

- `DATABASE_URL` points at the intended production database (verify by
  inspecting the Railway dashboard variable directly).
- None of `TEST_DATABASE_URL` / `E2E_DATABASE_URL` / `PERF_DATABASE_URL`
  / `CHAOS_DATABASE_URL` / `FILE_TEST_DATABASE_URL` /
  `RESTORE_DATABASE_URL` are set in the production environment.
- `NODE_ENV=production`.
- `TRUST_PROXY_HEADERS` remains unset/`false` unless separately
  verified per the existing pilot checklist.

## Migration order

Exactly one migration ships with this feature:
`prisma/migrations/20260712010000_multi_tenancy_organization/`. It runs
after the 7 pre-existing migrations already applied to production, via
the existing `npm run db:migrate:deploy` (wraps `prisma migrate deploy`,
never `migrate dev`) — no manual SQL, no separate steps. Prisma wraps
the entire migration file in one transaction for PostgreSQL (no
`CONCURRENTLY` statements are used), so it either fully applies or fully
rolls back — there is no partially-migrated production state possible
from a single run.

**Before running it against production**, confirm
`npx prisma migrate status` (against the production `DATABASE_URL`)
shows exactly the 7 pre-existing migrations already applied and this one
pending — not already applied (which would mean this checklist is being
run twice) and not skipping ahead of any other pending migration.

## Bootstrap organization behavior

The migration creates exactly one `Organization` row for all
pre-existing data:

```
id:       org_bootstrap_default
name:     Varsayılan Oda
province: Bilinmiyor
slug:     varsayilan-oda
isActive: true
```

Every pre-existing `User`, `Region`, `AuditLog`, and
`HistoricalDutyImportBatch` row is backfilled to this one organization.
Every pre-existing `Pharmacy` row gets a `normalizedName` computed via
the same trim/collapse-whitespace/lowercase algorithm the application's
own `normalizeText()` uses. This name is generic by design — see the
migration's own header comment — and should be renamed to the real
pilot chamber's actual name via `npm run org:rename` (see
`scripts/organizations/rename-organization.ts`) as a follow-up
**operator action**, not part of this migration itself.

## `PLATFORM_ADMIN` creation procedure

No `PLATFORM_ADMIN` user is created automatically by the migration or
seed script (`prisma/seed.ts`'s demo `PLATFORM_ADMIN`, if any, is
development-only — confirm before relying on it in production; it is
gated by the seed script's own production-safety guard). To create the
first production `PLATFORM_ADMIN`:

```sql
-- Run against the production database directly (psql or an equivalent
-- one-off script) — there is no UI to create the FIRST PLATFORM_ADMIN,
-- since PLATFORM_ADMIN is the role that manages Organizations
-- themselves and no chicken-and-egg self-service path exists by design.
INSERT INTO "User" (id, name, email, "passwordHash", role, "isActive", "organizationId", "createdAt", "updatedAt")
VALUES (
  gen_random_uuid()::text,        -- or any cuid-shaped id generator consistent with the app's own ids
  'Platform Yöneticisi',
  'platform-admin@<your-domain>', -- a real, access-controlled inbox
  '<scrypt-hashed password, see src/lib/auth/password.ts hashPassword()>',
  'PLATFORM_ADMIN',
  true,
  NULL,                            -- PLATFORM_ADMIN always has organizationId = NULL
  now(),
  now()
);
```

Generate the `passwordHash` value with the app's own hashing (never a
plaintext password, never a different hashing scheme):
`node -e "require('./src/lib/auth/password.ts')..."` is not directly
runnable without a TS loader — instead, run a short one-off script (or
add a temporary `scripts/platform-admin/bootstrap.ts`) that imports
`hashPassword` from `src/lib/auth/password.ts` and prints the result,
delete the script afterward, and never commit the plaintext password
anywhere (shell history, ticket, chat).

## Post-migration validation SQL

Run these against production immediately after the migration completes,
before considering the deploy successful:

```sql
-- Exactly one bootstrap organization, correct shape.
SELECT id, name, province, slug, "isActive" FROM "Organization";
-- Expect: exactly 1 row, id = 'org_bootstrap_default'.

-- Row counts match the pre-migration backup exactly (compare against
-- counts taken immediately before the migration).
SELECT 'User' t, count(*) FROM "User"
UNION ALL SELECT 'Region', count(*) FROM "Region"
UNION ALL SELECT 'Pharmacy', count(*) FROM "Pharmacy"
UNION ALL SELECT 'AuditLog', count(*) FROM "AuditLog"
UNION ALL SELECT 'HistoricalDutyImportBatch', count(*) FROM "HistoricalDutyImportBatch";

-- No orphaned tenant-owned rows.
SELECT count(*) FROM "User" WHERE "organizationId" IS NULL AND role != 'PLATFORM_ADMIN';
SELECT count(*) FROM "Region" WHERE "organizationId" IS NULL;
SELECT count(*) FROM "AuditLog" WHERE "organizationId" IS NULL;
SELECT count(*) FROM "HistoricalDutyImportBatch" WHERE "organizationId" IS NULL;
-- Expect: 0 for every one of the above.

-- normalizedName populated for every pharmacy.
SELECT count(*) FROM "Pharmacy" WHERE "normalizedName" IS NULL OR "normalizedName" = '';
-- Expect: 0.

-- New constraints/indexes exist.
\d "Region"        -- expect Region_organizationId_name_key (unique)
\d "Pharmacy"       -- expect Pharmacy_regionId_normalizedName_key (unique)
\d "PharmacyImportBatch"
\d "PharmacyImportRow"
```

If any of these checks fail, **stop** — do not let the application
start serving traffic against a state that failed validation. Proceed
to the rollback decision tree below.

## Smoke tests (multi-tenancy-specific, in addition to the existing pilot checklist's smoke tests)

- [ ] Log in as the pre-existing demo/pilot admin account — confirm it
      still works (it now belongs to `org_bootstrap_default`) and the
      dashboard shows the same pharmacy/region counts as before the
      migration.
- [ ] Confirm `/kullanicilar`, `/eczaneler`, `/bolgeler`,
      `/denetim-kayitlari` all render the same data as before the
      migration (org-scoped queries against the single bootstrap
      organization should be behaviorally identical to the pre-migration
      unscoped queries).
- [ ] Log in as the newly created `PLATFORM_ADMIN` — confirm
      `/platform/kurumlar` shows exactly the one bootstrap organization,
      and that this account cannot reach `/eczaneler` or any other
      tenant route (redirected to `/giris`, per
      `docs/security/PLATFORM_ADMIN_ISOLATION_VALIDATION.md`).
- [ ] Create one throwaway test organization via `/platform/kurumlar/yeni`
      with synthetic data, confirm its first ADMIN can log in and sees
      zero pharmacies/regions (proving the new organization is
      genuinely isolated from the bootstrap org's real data), then
      deactivate and leave it (do not delete — no delete tool exists;
      an inactive throwaway organization is harmless).
- [ ] As the bootstrap organization's ADMIN, download the pharmacy
      import template (`/eczaneler/ice-aktar/sablon`) and confirm it
      opens correctly — proves the new route is live and permission-gated
      correctly in production, without actually importing anything.

## Rollback decision tree

```
Deploy failed / smoke test failed / post-migration validation SQL failed
  │
  ├─ Did the migration itself fail to apply (P3018 / transaction rolled back)?
  │    └─ YES → Application rollback only. The migration's own transaction
  │             already guarantees the schema is untouched (see
  │             docs/architecture/MULTI_TENANCY.md's migration section —
  │             verified three ways in this branch's acceptance gate,
  │             including a deliberate collision scenario). Redeploy the
  │             previous commit (00a0979); no DB action needed.
  │
  └─ Did the migration apply successfully, but a LATER problem surfaced
     (application bug, unexpected data shape, smoke test failure AFTER
     the post-migration validation SQL already passed)?
       │
       ├─ Is the problem a pure application-code defect (e.g. a page
       │  crashes, a permission check is wrong) with the underlying
       │  data still correct per the validation SQL above?
       │    └─ YES → Application rollback is sufficient. Redeploy
       │             00a0979. Caution: 00a0979's code expects the
       │             PRE-migration schema shape (no organizationId
       │             columns) — rolling back application code while the
       │             NEW schema is in place will break it. Do not mix:
       │             either roll back both code AND schema (full DB
       │             restore), or fix forward on the new schema. A
       │             plain code-only rollback is NOT safe here, unlike
       │             the general case in
       │             docs/operations/PILOT_DEPLOYMENT_CHECKLIST.md.
       │
       └─ Is the problem data corruption, a security issue (any
          observed cross-tenant leak, authentication bypass), or does
          reverting require the pre-migration schema shape?
            └─ YES → Full DB restore is required
                     (docs/testing/BACKUP_RESTORE_REHEARSAL.md), using
                     the backup taken before this deploy started, PLUS
                     application rollback to 00a0979. This is the only
                     safe path once the schema itself must be reverted —
                     row-shape assumptions (organizationId, normalizedName,
                     new constraints) differ between the two commits.
```

**Default to the DB-restore path** for anything you're not fully certain
falls in the "pure application-code defect" branch — the cost of an
unnecessary restore (a few minutes of downtime, already backed up) is
far lower than the cost of running old code against a schema it doesn't
understand, or new code against data that was never actually correctly
backfilled.

## When application rollback is enough

Only when **all** of the following hold:
- The migration transaction itself committed successfully (confirmed by
  the post-migration validation SQL above passing).
- No cross-tenant data leak, authentication bypass, or data corruption
  was observed.
- The only observed problem is isolated to application code behavior
  (a specific page/action bug), not a data-shape assumption.
- You are rolling back to a commit that **also** expects the
  post-migration schema shape (i.e., not all the way back to `00a0979`,
  which expects the old schema) — for example, rolling back `e755a79`
  (Pharmacy Excel Import) to `f839245` (Platform Administration) while
  keeping the migration applied is safe, since both expect the same
  schema.

## When DB restore is required

- Rolling back past `53b6740` (i.e., back to `00a0979` or earlier) while
  the migration has already been applied — the old code does not
  understand the new schema.
- Any observed cross-tenant data leak or authentication bypass,
  regardless of which commit is suspected — restore first, investigate
  after, per the existing pilot checklist's incident-response principle.
- Any indication the migration's backfill itself produced incorrect
  data (wrong `organizationId` assignments, incorrectly computed
  `normalizedName` values) that the post-migration validation SQL did
  not catch but was discovered later — the backfill only runs once, by
  design; there is no re-run/repair tool.
