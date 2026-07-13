# Multi-Tenancy Architecture

Branch `feature/multi-tenancy-pharmacy-import`. Describes the actual,
shipped design — not an aspirational plan.

## Model

Single Postgres database, single application deployment, many
organizations ("pharmacist chambers"). Tenant isolation is enforced at
the application layer, not via Postgres row-level security or separate
schemas/databases per tenant — a deliberate simplicity choice appropriate
to this app's scale (see `CLAUDE.md`: "multi-tenant SaaS complexity
unless explicitly requested later").

### `Organization` (`prisma/schema.prisma`)

```
Organization { id, name, province, slug (unique), isActive, createdAt, updatedAt }
```

Every tenant-owned row either has a direct `organizationId` column
(`User`, `Region`, `AuditLog`, `HistoricalDutyImportBatch`,
`PharmacyImportBatch`) or derives ownership through a non-nullable
parent relation (`Pharmacy` → `Region.organizationId`; `DutySchedule`,
`DutyRule`, `HistoricalDutyRecord`, `DutyRequest`, `PharmacyImportRow` →
ultimately through `Region` or `Pharmacy`).

Two models are deliberately **not** tenant-scoped:
- `Holiday` — national/religious calendar facts, shared/global by
  design (see `CLAUDE.md` scheduling principles).
- `LoginAttempt` — rate-limit bucket keyed by a one-way hash of the
  identifier, pre-authentication, never tied to any organization.

### `UserRole.PLATFORM_ADMIN`

A user role with `organizationId: null` by design. Manages
`Organization` rows themselves (create, activate/deactivate, edit) —
never any organization's own tenant data. See
`docs/features/PLATFORM_ORGANIZATION_ADMINISTRATION.md`.

## Enforcement points

- `src/lib/auth/tenant.ts` — `requireOrganizationUser`,
  `requireOrganizationRole`, `requireOrganizationRoleOrRedirect`,
  `requireOrganizationMember`. Every one of these derives
  `organizationId` from the authenticated session
  (`getCurrentUser()`/`getCurrentUser().organizationId`) — **never**
  from a form field, query parameter, hidden input, or client-supplied
  cookie value. This is the single rule the entire tenant boundary rests
  on.
- `src/lib/auth/platform.ts` — `requirePlatformAdmin()`. Completely
  separate from `tenant.ts`; no organization-scoped guard ever accepts
  `PLATFORM_ADMIN` as a substitute role, and `requirePlatformAdmin()`
  grants nothing beyond the `/platform` area.
- `src/lib/auth/session.ts` — `getCurrentUser()` returns `null` if the
  session is missing/expired, the user is inactive, or (for any
  non-`PLATFORM_ADMIN` role) the user's own `organization.isActive` is
  not `true`. A deactivated organization therefore blocks every one of
  its users on every request, without touching a `Session` row.
- `scripts/tenant-safety/scan-unscoped-queries.ts` — a static scanner
  (run via `npm run <script>` / directly with `tsx`) that flags any
  Prisma call against a tenant-owned model with no `organizationId`
  nearby, unless explicitly allowlisted with a documented reason and
  safety category (`[parent-scoped query]`, `[pre-auth login path]`,
  `[platform-only operation]`). Run this after touching any Prisma call
  site; it must report zero unreviewed findings.

## Cross-tenant guarantees, proven by test

- `tests/e2e/specs/tenant-isolation.spec.ts` — two real organizations,
  real browser, real Postgres: direct-URL access to another org's
  pharmacy/region/schedule/export is blocked (`notFound()`, never a 200
  with foreign data); dashboard counts, audit logs, and identically
  named regions never leak across the boundary; an inactive
  organization blocks login; `PLATFORM_ADMIN` never gets tenant
  dashboard access.
- `tests/integration/tenant-scoping.integration.test.ts`,
  `tests/integration/public-route-isolation.integration.test.ts`,
  `tests/integration/scheduling-balance-isolation.integration.test.ts`
  — the same guarantees at the Server Action / query level, including
  two organizations with **identical** region and pharmacy names (the
  case that would expose a name-based-matching bug instead of an
  id-based one).
- `tests/integration/pharmacy-excel-import.integration.test.ts`,
  `tests/integration/pharmacy-import-lifecycle.integration.test.ts` —
  the same guarantees for the Pharmacy Excel Import feature
  specifically (see `docs/features/PHARMACY_EXCEL_IMPORT.md`).

## Migration

One atomic migration,
`prisma/migrations/20260712010000_multi_tenancy_organization/`:
creates `Organization`, backfills every pre-existing row into one
bootstrap organization (`id='org_bootstrap_default'`, generic
name/province — never a real chamber's name hardcoded), populates
`Pharmacy.normalizedName`, tightens the new columns to `NOT NULL`, and
validates (inside the same transaction, via a `DO $$ ... RAISE
EXCEPTION` block) that no backfilled row would violate the new
`(organizationId, name)` / `(regionId, normalizedName)` unique
constraints before committing. See
`docs/operations/MULTI_TENANCY_PRODUCTION_DEPLOYMENT.md` for the
rehearsed rollout procedure.
