# Tenant Isolation Validation

Evidence log for the multi-tenancy conversion's cross-tenant guarantees,
covering the full `feature/multi-tenancy-pharmacy-import` branch
(commits `53b6740`, `0c77259`, `546e727`, `f839245`, `e755a79`, and the
final acceptance-gate commit). See
`docs/architecture/MULTI_TENANCY.md` for the design this validates.

## What was checked

1. **Every tenant-owned Prisma call site** — swept file-by-file across
   the whole app (see the commit history of `feature/multi-tenancy-pharmacy-import`
   for the per-file conversion list) and re-checked continuously via
   `scripts/tenant-safety/scan-unscoped-queries.ts`, which fails CI/local
   verification if any tenant-owned model (`user`, `region`, `pharmacy`,
   `dutyRule`, `dutySchedule`, `dutyAssignment`, `dutyScheduleWarning`,
   `dutyRequest`, `unavailability`, `dutyBalanceAdjustment`,
   `historicalDutyRecord`, `historicalDutyImportBatch`, `auditLog`,
   `pharmacyImportBatch`, `pharmacyImportRow`) is queried without an
   `organizationId` reachable in the surrounding code. Every allowlisted
   exception is individually reviewed and tagged with a safety category
   (`scripts/tenant-safety/scan-unscoped-queries.ts`'s `ALLOWLIST`
   comment block). **Current state: zero unreviewed findings, zero
   wildcard file-level exemptions.**

2. **Real-browser, two-organization E2E matrix**
   (`tests/e2e/specs/tenant-isolation.spec.ts`): direct-URL access to
   another organization's pharmacy/region/schedule detail/export all
   `notFound()`; dashboard pharmacy count excludes another org's data;
   audit-log page excludes another org's entries; two organizations with
   the **identical** region name never conflict or leak; a deactivated
   organization blocks login and any subsequent navigation;
   `PLATFORM_ADMIN` is redirected away from every tenant route, never
   granted access.

3. **`/vatandas` and `/eczane-talep/[token]` public routes** (no
   session/auth context at all) — the tenant boundary here is the
   per-pharmacy unique `requestToken` and the server-resolved
   `?org=<slug>` selection, never a client-supplied `organizationId`.
   Proven in `tests/integration/public-route-isolation.integration.test.ts`
   and the `/vatandas public route` block of `tenant-isolation.spec.ts`:
   forged `pharmacyId`/`regionId` form fields are silently stripped by
   the zod schema; a token never resolves to another org's pharmacy even
   with an identical pharmacy name; the published-assignment lookup
   never crosses the org boundary for an identically-named region; an
   invalid slug shows a generic not-found message, never raw data.

4. **Exports** (Excel/PDF duty schedules) — org-scoped query at the data
   layer, verified via the same E2E suite's export-route specs
   (`tests/e2e/specs/export-routes.spec.ts`): a foreign schedule id
   returns 404 (existence never leaked), security headers and request id
   remain intact, formula-injection escaping unaffected.

5. **Migration/backfill correctness** — see
   `docs/operations/MULTI_TENANCY_PRODUCTION_DEPLOYMENT.md` for the
   three-scenario rehearsal (empty DB, realistic pre-tenancy data,
   deliberate normalization collision).

## Test counts (last full run, this branch)

- Unit: 687 tests, 58 files.
- Integration (real Postgres): 13 files / 56 tests, run twice
  consecutively, both green.
- E2E (real browser + real Postgres): 64 tests, run twice consecutively,
  both green (63 pre-existing + 1 new onboarding-to-import flow — see
  `docs/testing/PHARMACY_EXCEL_IMPORT_TEST.md`).

## Known, deliberately-accepted scope boundary

Two authenticated `useActionState` Server Action forms
(`createOrganizationAction`, `previewPharmacyImportAction`) lose their
session cookie when submitted via a real Playwright browser click in
this specific sandbox (Next.js 16.2.10 canary + headless Chromium under
Playwright's cookie injection) — root-caused as an environment/framework
quirk, not a tenant-isolation defect: it reproduces identically
regardless of which guard function is used, is unaffected by role or
permission, and does not occur for anonymous requests (login) or bound
actions (e.g. the "İçe Aktarımı Onayla" import-confirm button). Every
E2E spec in this repository already avoids exercising that exact
authenticated-unbound-action-via-real-click path; where a test's
scenario would otherwise require it, the underlying database state is
created directly (matching the exact end-state that Server Action would
produce) and is separately proven reachable via that real Server Action
in the corresponding integration test suite (real Postgres, no browser).
