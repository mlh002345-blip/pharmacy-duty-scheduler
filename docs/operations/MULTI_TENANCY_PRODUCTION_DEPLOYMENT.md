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
pilot chamber's actual name as a follow-up **operator action**, not
part of this migration itself, using the platform administration UI:

1. Log in as `PLATFORM_ADMIN` (created via the procedure below).
2. Open `/platform/kurumlar` — the bootstrap organization appears as
   "Varsayılan Oda".
3. Select it, then open its edit page
   (`/platform/kurumlar/[id]/duzenle`).
4. Update the organization **name** to the real chamber's name, the
   **province** ("İl / Bölge") to its real province, and the **slug**
   to a matching short identifier (or clear it to auto-generate from
   the new name).
5. Save, and verify the updated name/province/slug on the
   organization's summary page (`/platform/kurumlar/[id]`).

> **Stale migration comment**: the migration file's own header comment
> (`prisma/migrations/20260712010000_multi_tenancy_organization/migration.sql`)
> still references an `npm run org:rename` script that was never
> created — the UI workflow above is the actual supported rename path.
> That comment is SQL comment text only: it is never executed, has no
> effect on what the migration does at runtime, and is deliberately
> left unedited because modifying an already-locally-applied migration
> file changes its Prisma checksum and would force re-resolution on
> every database that has applied it.

## `PLATFORM_ADMIN` creation procedure

No `PLATFORM_ADMIN` user is created automatically by the migration or
seed script (`prisma/seed.ts`'s demo `PLATFORM_ADMIN`, if any, is
development-only — confirm before relying on it in production; it is
gated by the seed script's own production-safety guard). There is no UI
to create the FIRST `PLATFORM_ADMIN` — `PLATFORM_ADMIN` is the role
that manages Organizations themselves, and no chicken-and-egg
self-service path exists by design.

Use the dedicated bootstrap script `scripts/create-platform-admin.ts`
(`npm run db:create-platform-admin`). It reads `PLATFORM_ADMIN_EMAIL`,
`PLATFORM_ADMIN_PASSWORD`, and (optionally) `PLATFORM_ADMIN_NAME`
(default "Platform Yöneticisi") from the environment, validates them
with the app's own rules (valid email, minimum 8-character password),
hashes the password with the app's real scrypt implementation
(`src/lib/auth/password.ts`), and creates exactly one user with
`role = PLATFORM_ADMIN`, `organizationId = NULL`, `isActive = true`. It
is safe by construction:

- If the same `PLATFORM_ADMIN` already exists, it exits successfully
  **without changing anything** (including the password) — re-running
  it is idempotent.
- If the email belongs to an existing tenant user, or a *different*
  `PLATFORM_ADMIN` already exists, it aborts with a non-zero exit code
  and changes nothing. There is deliberately no overwrite flag.
- It never prints the password, the hash, or `DATABASE_URL`.

### Railway dashboard-only bootstrap (no SSH, no SQL)

1. In the Railway dashboard, open the **application service** (not the
   Postgres service) → **Variables**, and temporarily add:
   - `PLATFORM_ADMIN_EMAIL` — a real, access-controlled inbox
     (e.g. `platform-admin@<your-domain>`).
   - `PLATFORM_ADMIN_PASSWORD` — a strong password (min 8 characters;
     use far more for this role). Do not record it in tickets or chat.
   - Optionally `PLATFORM_ADMIN_NAME`.
2. In the service's **Settings → Deploy**, temporarily set the
   pre-deploy command to:
   `npm run db:migrate:deploy && npm run db:create-platform-admin`
3. Trigger **one** deploy.
4. In the deploy logs, confirm exactly one line:
   `PLATFORM_ADMIN oluşturuldu: <email>` (or, on a re-run,
   `PLATFORM_ADMIN zaten mevcut: <email>...`). Confirm no password,
   hash, or connection string appears anywhere in the log output — the
   script never emits them.
5. **Immediately** delete `PLATFORM_ADMIN_EMAIL`,
   `PLATFORM_ADMIN_PASSWORD`, and `PLATFORM_ADMIN_NAME` from the
   service variables.
6. Restore the pre-deploy command to `npm run db:migrate:deploy`.
7. Redeploy (the variable deletion typically triggers this anyway) and
   confirm the app starts cleanly.
8. Verify: log in at `/giris` with the new account and confirm you are
   redirected to `/platform` (the organization list at
   `/platform/kurumlar`). Because the password briefly existed as a
   dashboard variable, change it via the UI after first login.

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
  │             including a deliberate collision scenario). Because the
  │             migration never applied, the database is still in the
  │             PRE-migration shape 00a0979 expects — redeploy 00a0979;
  │             no DB action needed. (This is the ONLY branch where
  │             redeploying 00a0979 without a DB restore is safe.)
  │
  └─ Did the migration apply successfully, but a LATER problem surfaced
     (application bug, unexpected data shape, smoke test failure AFTER
     the post-migration validation SQL already passed)?
       │
       │  ** Once 20260712010000_multi_tenancy_organization has been
       │  ** applied, NEVER redeploy 00a0979 against the migrated
       │  ** database — its code expects the PRE-migration schema (no
       │  ** organizationId columns, no normalizedName, old constraints)
       │  ** and will break against the new one. Every branch below
       │  ** follows from that rule.
       │
       ├─ Is the problem a pure application-code defect (e.g. a page
       │  crashes, a permission check is wrong) with the underlying
       │  data still correct per the validation SQL above — AND is
       │  there a rollback target commit that still expects the
       │  POST-migration schema?
       │    └─ YES → Application-only rollback to that
       │             schema-compatible commit. Example: rolling back
       │             bac2b5c or e755a79 to f839245 is schema-compatible
       │             (all three expect the migrated schema). Rolling
       │             back to 00a0979 is NOT schema-compatible and is
       │             not an option on this branch — if no
       │             schema-compatible target exists, fix forward or
       │             take the DB-restore branch below.
       │
       └─ Is the problem data corruption, a security issue (any
          observed cross-tenant leak, authentication bypass), or does
          the rollback require returning to 00a0979 (or any other
          pre-migration commit)?
            └─ YES → Restore the pre-migration database backup FIRST
                     (docs/testing/BACKUP_RESTORE_REHEARSAL.md), using
                     the backup taken before this deploy started, THEN
                     redeploy 00a0979. This order is mandatory — the
                     restore returns the database to the schema shape
                     00a0979 expects; only then is running 00a0979
                     safe. Row-shape assumptions (organizationId,
                     normalizedName, new constraints) differ between
                     the two commits, so neither step alone is
                     sufficient.
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
