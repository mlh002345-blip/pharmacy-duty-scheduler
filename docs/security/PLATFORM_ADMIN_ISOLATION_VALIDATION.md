# PLATFORM_ADMIN Isolation Validation

Evidence log specific to the `PLATFORM_ADMIN` role's boundary. See
`docs/features/PLATFORM_ORGANIZATION_ADMINISTRATION.md` for the feature
this validates.

## The two things being proven

1. **`PLATFORM_ADMIN` can never act inside a tenant's own data.**
   `ROLE_PERMISSIONS[PLATFORM_ADMIN] = []` in
   `src/lib/auth/permissions.ts` — the role holds zero organization-scoped
   permissions, so `hasPermission(role, anyPermission)` is always `false`
   for it, and `requireOrganizationRole`/`requireOrganizationUser`
   (`src/lib/auth/tenant.ts`) reject it before any permission check even
   runs, since `organizationId` is `null`.

2. **Ordinary organization roles can never act inside `/platform`.**
   `requirePlatformAdmin()` (`src/lib/auth/platform.ts`) checks
   `user.role !== "PLATFORM_ADMIN"` directly — an organization `ADMIN`'s
   own `manageUsers`/`manageSetupData`/etc. permissions are never
   consulted, so there is no permission an org `ADMIN` could be granted
   that would let it reach `/platform`.

## Test evidence

- `tests/integration/platform-organization.integration.test.ts`:
  `requirePlatformAdmin` rejects an anonymous caller (redirect to
  `/giris`) and an ordinary organization `ADMIN` (redirect away, no
  organization created).
- `tests/e2e/specs/platform-access.spec.ts`: anonymous, `ADMIN`, `STAFF`,
  `VIEWER` (organization roles) all denied `/platform/kurumlar` and
  `/platform/kurumlar/yeni` by direct URL — server-side, not merely
  hidden from navigation (verified by confirming no `Organization` row
  was created after the denied attempt). `PLATFORM_ADMIN` reaches
  `/platform/kurumlar`, and the organization dashboard `Sidebar`'s own
  nav items (e.g. "Eczaneler") are asserted to never render there.
- `tests/e2e/specs/tenant-isolation.spec.ts` ("PLATFORM_ADMIN does not
  automatically receive organization-level dashboard access"): a
  `PLATFORM_ADMIN` session navigating to `/eczaneler` is redirected by
  `requireOrganizationMember()` to `/giris`, which then recognizes the
  already-logged-in `PLATFORM_ADMIN` and forwards it to `/platform` — the
  tenant dashboard itself never renders.
- `tests/integration/pharmacy-import-lifecycle.integration.test.ts`
  ("PLATFORM_ADMIN cannot consume any organization's batch"): a
  `PLATFORM_ADMIN` session calling `importPharmacyBatchAction` for a
  real, valid batch is rejected before any row is touched; the batch
  stays `PREVIEWED`.

## Explicitly out of scope (by product decision, not oversight)

Tenant impersonation — a hypothetical future feature letting
`PLATFORM_ADMIN` temporarily act as a specific organization for support
purposes — does not exist in this codebase. No code path grants
`PLATFORM_ADMIN` organization-scoped access under any condition today.
