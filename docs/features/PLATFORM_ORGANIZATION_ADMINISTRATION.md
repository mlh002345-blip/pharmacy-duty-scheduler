# Platform Administration and Organization Onboarding

Multi-Tenancy Chunk 2, branch `feature/multi-tenancy-pharmacy-import`
(commit `f839245`).

## Purpose

A separately-guarded area for `PLATFORM_ADMIN` to create and manage
pharmacy chambers (`Organization` rows) themselves — distinct from, and
never granting, access to any organization's own tenant data.

## Routes (`src/app/platform/`)

- `/platform` → redirects to `/platform/kurumlar`.
- `/platform/kurumlar` — list, search (name/province/slug), active/passive
  filter.
- `/platform/kurumlar/yeni` — create an organization and its first
  `ADMIN` user, atomically.
- `/platform/kurumlar/[id]` — summary: status, slug, user/region/pharmacy
  counts, list of `ADMIN` users.
- `/platform/kurumlar/[id]/duzenle` — edit name/province/slug.
- Activate/deactivate is a status-toggle action on the summary page.

`src/app/platform/layout.tsx` calls `requirePlatformAdmin()` once for
the whole area — no page underneath re-checks the role, matching the
convention that this is a single-role area, not a permission-filtered
subset of the tenant dashboard. The organization `Sidebar` component
(driven by `hasPermission()`, which is always empty for
`PLATFORM_ADMIN`) is never rendered here; `/platform` has its own
minimal header.

## Access control

`importPharmacies`-style role check does not apply here — the guard is
`requirePlatformAdmin()` only:
- `PLATFORM_ADMIN`: full access to `/platform/*`.
- Ordinary `ADMIN`/`STAFF`/`VIEWER` (any organization): redirected to
  `/`, never granted access, whether via navigation or direct URL.
- Anonymous: redirected to `/giris`.

Proven in `tests/e2e/specs/platform-access.spec.ts` (anonymous, ADMIN,
STAFF, VIEWER all denied by direct URL; `PLATFORM_ADMIN` reaches the
area and never sees the tenant sidebar) and
`tests/integration/platform-organization.integration.test.ts`.

## Organization creation transaction

`createOrganizationAction` (`src/app/platform/kurumlar/actions.ts`), one
`prisma.$transaction`:

1. Slug is normalized via `normalizeOrganizationSlug()`
   (`src/lib/validations/organization.ts`), which defers to the
   existing `toAsciiSlug()` (`src/lib/slug.ts`) — Turkish-aware
   transliteration, lowercase, hyphenated, defaults from the org name
   when left blank.
2. Slug and admin email uniqueness are pre-checked, then also enforced
   at the DB level (`Organization.slug` unique, `User.email` unique) —
   a P2002 race is mapped back to the correct form field via
   `error.meta.target`, never a raw Prisma error.
3. `Organization` row created.
4. First `ADMIN` user created with `organizationId` set to the new org,
   `role: "ADMIN"`, and `isActive` **only** `true` if the organization
   itself is created active — an inactive organization never gets a
   working login path.
5. One `AuditLog` row (`entity: "Organization"`, `action: "CREATE"`)
   whose `after` payload contains only
   `{ organizationId, slug, createdAdminUserId, platformActorId }` —
   never a password, password hash, or full session token. Verified
   directly in
   `tests/integration/platform-organization.integration.test.ts`
   (`expect(JSON.stringify(after)).not.toMatch(/password/i)`).

Any failure (duplicate slug/email, unexpected error) rolls back the
whole transaction — no partial `Organization` row without its first
`ADMIN`, and vice versa.

## Deactivation

`setOrganizationStatusAction`, one transaction:

- Blocked by `assertLastActiveOrganizationNotDeactivated()`
  (`src/lib/auth/organization-guard.ts`, mirroring the existing
  per-organization "last active ADMIN" advisory-lock pattern in
  `admin-guard.ts`, but with a single global lock key since this rule is
  evaluated across all organizations) whenever it would leave zero
  active organizations system-wide.
- On deactivation, every `Session` row belonging to that organization's
  users is deleted in the same transaction as the `isActive` flip. New
  logins fail with the existing generic message (`getCurrentUser()`'s
  organization-active check).
- Reactivation flips `isActive` back but never resurrects deleted
  sessions — affected users simply log in again.

## Login redirect

`src/app/giris/page.tsx`: an already-logged-in organization member is
redirected to `/`; an already-logged-in `PLATFORM_ADMIN` (which has no
`organizationId`) is redirected to `/platform` instead of `/`, since `/`
requires organization membership and would otherwise redirect back to
`/giris`, looping.
