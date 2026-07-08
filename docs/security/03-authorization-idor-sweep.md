# Authorization & IDOR Sweep

Date: 2026-07-08 (audit), fixes applied same day, same branch
(`deploy/postgresql-demo`).

This document covers the audit of **who may do what** — role-based
authorization and object-ID handling across every mutating operation and
every ID-accepting page — and the two small actionable fixes applied from
that audit. Authentication (session validity, login) is assumed working
and is covered separately in `02-authentication-session-handling.md`.

Model context: this is a **single-tenant** app (one pharmacist chamber).
There is no cross-org/cross-user data ownership — authorization here means
**role-based permission** (`ADMIN` > `STAFF` > `VIEWER`, defined in
`src/lib/auth/permissions.ts`), not per-resource ownership. "IDOR" in this
app means: does an action trust a client-supplied ID to select/mutate a
record without the correct role check gating it first, or does an ID from
one context leak into a different one it shouldn't (e.g., cross-schedule
assignment edits)?

## Operations inspected

### Server Actions (27 total, all in `src/app/**/actions.ts`)

`bolgeler`: `createRegionAction`, `updateRegionAction`,
`toggleRegionStatusAction`, `deleteRegionAction`.
`eczaneler`: `createPharmacyAction`, `updatePharmacyAction`,
`togglePharmacyStatusAction`, `deletePharmacyAction`.
`kurallar`: `upsertDutyRuleAction`.
`tatil-gunleri`: `createHolidayAction`, `updateHolidayAction`,
`deleteHolidayAction`.
`mazeretler`: `createUnavailabilityAction`, `updateUnavailabilityAction`,
`deleteUnavailabilityAction`.
`nobet-talepleri`: `createDutyRequestAction`, `reviewDutyRequestAction`.
`gecmis-nobetler`: `historicalImportAction`,
`createBalanceAdjustmentAction`, `deleteBalanceAdjustmentAction`.
`cizelgeler`: `createDutyScheduleAction`, `deleteDutyScheduleAction`,
`publishDutyScheduleAction`, `unpublishDutyScheduleAction`.
`cizelgeler/[id]/atama`: `editDutyAssignmentAction`.
`kullanicilar`: `createUserAction`, `updateUserAction`,
`toggleUserStatusAction`.
`eczane-talep/[token]`: `createPublicDutyRequestAction` (intentionally
public, token-scoped).

### Route Handlers (4 total)

`cizelgeler/[id]/export/excel/route.ts`, `cizelgeler/[id]/export/pdf/route.ts`,
`gecmis-nobetler/sablon/route.ts`, `eczane-talep/[token]/page.tsx` (GET,
public by design).

### ID-accepting pages (13 total)

`bolgeler/[id]/duzenle`, `bolgeler/yeni`, `eczaneler/[id]/duzenle`,
`eczaneler/yeni`, `kurallar/[regionId]/duzenle`,
`tatil-gunleri/[id]/duzenle`, `tatil-gunleri/yeni`,
`mazeretler/[id]/duzenle`, `mazeretler/yeni`, `kullanicilar/[id]/duzenle`,
`kullanicilar/yeni`, `cizelgeler/yeni`,
`cizelgeler/[id]/atama/[assignmentId]/duzenle` (the one page with two IDs
in the URL — audited specifically for the classic IDOR shape),
`nobet-talepleri/[id]`.

## Finding table

| # | Finding | Status |
|---|---|---|
| 1 | `deleteRegionAction`/`deletePharmacyAction` used `manageSetupData` (STAFF-accessible) for destructive deletes | **Fixed** |
| 2 | `gecmis-nobetler/sablon/route.ts` had no `hasPermission` check, only login | **Fixed** |
| 3 | No true IDOR found anywhere in the app | Documented only |
| 4 | Public token route (`/eczane-talep/[token]`) correctly scoped | Documented only |
| 5 | Assignment edit page verifies `assignment.dutyScheduleId === scheduleId` | Documented only |
| 6 | `deleteBalanceAdjustmentAction` reuses `manageUsers` as an ADMIN proxy | Documented only |
| 7 | Single-tenant architecture has no per-organization ownership checks | Documented only |

---

### 1. Destructive setup deletes restricted to ADMIN — **Fixed**

**Before:** `deleteRegionAction` and `deletePharmacyAction` both gated on
`manageSetupData`, which `STAFF` also holds — so any STAFF account could
permanently delete a region or pharmacy (subject to the existing safety
guards: a region can't be deleted while pharmacies are attached, a
pharmacy can't be deleted while it has duty assignments). Not an IDOR —
the check ran correctly, before the mutation — but the blast radius was
broader than necessary for an irreversible operation.

**Fix:**
- Added a new permission, `deleteSetupData`, to
  `src/lib/auth/permissions.ts`. It's granted to `ADMIN` only — `STAFF`
  and `VIEWER` do not have it. No existing ADMIN-only permission fit
  semantically (`deleteSchedule` is schedule-specific, `manageUsers` is
  user-specific), so a minimal, purpose-named permission was added rather
  than overloading an unrelated one.
- `deleteRegionAction` and `deletePharmacyAction` now require
  `deleteSetupData` instead of `manageSetupData`.
- **Unchanged:** `createRegionAction`, `updateRegionAction`,
  `toggleRegionStatusAction`, `createPharmacyAction`,
  `updatePharmacyAction`, `togglePharmacyStatusAction` — all still use
  `manageSetupData`, so STAFF retains full create/edit/activate-deactivate
  capability on regions and pharmacies, exactly as before.
- The list pages (`bolgeler/page.tsx`, `eczaneler/page.tsx`) now compute a
  separate `canDelete` flag and only render the delete button when it's
  true, so STAFF no longer sees a delete action that would fail
  server-side — a UI-consistency fix, not the actual security boundary
  (which is the server-side check).

**Tests** (`src/app/(dashboard)/bolgeler/actions.test.ts`,
`src/app/(dashboard)/eczaneler/actions.test.ts`, 4 cases each — these
mock only the DB/audit/redirect leaves and let the real
`requirePermissionOrRedirect` + `hasPermission` run, so the tests exercise
the actual permission wiring, not a stand-in):
- STAFF cannot delete a region / pharmacy (redirected, `delete` never called)
- VIEWER cannot delete a region / pharmacy
- ADMIN can delete a region / pharmacy when the safety guard allows (no
  attached pharmacies / no attached duty assignments)
- ADMIN is still blocked by the pre-existing safety guard when the region
  has pharmacies / the pharmacy has duty assignments — confirming the fix
  didn't weaken the unrelated safety check

### 2. Historical duty template route now requires `manageSetupData` — **Fixed**

**Before:** `gecmis-nobetler/sablon/route.ts` checked only
`getCurrentUser()` (any authenticated role) before returning an `.xlsx`
file containing 3 real pharmacies' name/phone/address as sample rows. The
two sibling export routes in the same feature area (`export/excel`,
`export/pdf`) both additionally check `hasPermission(role, "exportSchedule")`
— this route was the one inconsistent gap.

**Fix:**
- Added `if (!hasPermission(user.role, "manageSetupData")) return 403` —
  the same permission the actual import action
  (`historicalImportAction`) requires, so "can you download the template"
  now matches "can you use it." `VIEWER` (which lacks `manageSetupData`)
  is blocked; `STAFF` and `ADMIN` are unaffected.
- The "Örnek Geçmiş Nöbet Şablonu İndir" button on `/gecmis-nobetler` is
  now only rendered when `canManage` is true, matching the other
  management-only controls already on that page.

**Tests** (`src/app/(dashboard)/gecmis-nobetler/sablon/route.test.ts`,
4 cases): VIEWER gets `403` and the DB is never queried; STAFF and ADMIN
both get `200` with the correct Excel content type; an unauthenticated
request still redirects to `/giris`.

---

## Documented-only items (no code change)

### 3. No true IDOR found

Across all 27 actions, 4 route handlers, and every ID-accepting page, no
case was found where a client-supplied object ID was used to read or
mutate a resource without a preceding, correctly-scoped permission check,
and no case where a privilege check ran after the effect or was left to
client-side enforcement alone. Every action's own permission check runs
server-side, before the corresponding Prisma read/write, matched to the
operation's actual sensitivity (e.g. `deleteSchedule` and now
`deleteSetupData` are ADMIN-only where the other two roles have broader
CRUD).

### 4. Public token route correctly scoped

`createPublicDutyRequestAction` (`src/app/eczane-talep/[token]/actions.ts`)
never accepts `pharmacyId` from the client at all — the pharmacy is
derived exclusively from the server-side `requestToken` lookup, and the
created request's `status` is hardcoded to `PENDING` (the caller cannot
self-approve). This is the correct pattern for a token-scoped,
unauthenticated public endpoint and needed no change.

### 5. Assignment edit page cross-validates its two URL IDs

`cizelgeler/[id]/atama/[assignmentId]/duzenle/page.tsx` is the one page in
the app with two IDs in its URL — the classic IDOR shape (an assignment ID
and a schedule ID that may or may not actually belong together). It
explicitly checks `assignment.dutyScheduleId !== scheduleId → notFound()`
before rendering anything, and the bound server action
(`editDutyAssignmentAction`) doesn't even receive `scheduleId` as a
parameter — it re-derives the schedule/region context from `assignmentId`
alone. No change needed.

### 6. `deleteBalanceAdjustmentAction` reuses `manageUsers` as an ADMIN proxy

This action correctly restricts deletion to ADMIN (checked before the
delete), but does so by checking `manageUsers` — a permission whose name
is about user management, not duty-balance data — rather than a
dedicated permission. No bypass exists today. This is a naming/semantic
clarity issue, not a security gap, and was left as-is in this pass per
scope (only `deleteSetupData` was added, to keep the permission surface
minimal as instructed); a future pass could introduce a more precisely
named ADMIN-only permission if more ADMIN-only, non-user operations
accumulate.

### 7. Single-tenant architecture

The app has no concept of "organization" or per-tenant ownership — every
`Region`, `Pharmacy`, `DutySchedule`, etc. is globally visible to any
authenticated user whose role permits the relevant action. This is
correct and sufficient for the current one-chamber deployment. It is
explicitly **not** sufficient for a hypothetical future multi-tenant SaaS
version of this product: if the app ever serves multiple independent
pharmacist chambers from one deployment, every Prisma query in this audit
would need an added `where: { organizationId }` (or equivalent) scope,
and every server action would need to verify the acting user belongs to
the same organization as the target resource — none of which exists
today because it isn't needed today. Flagged here so it isn't
rediscovered as a surprise if multi-tenancy is ever pursued.

## Verification performed

- `npm run typecheck` (via `npx tsc --noEmit`) — clean
- `npm run lint` — clean
- `npm test` — 123/123 passing (12 new tests added across the two fixes)
- `npm run build` — production build succeeds
- No schema or migration changes were required for either fix — the new
  `deleteSetupData` permission is an in-memory role-to-permission mapping
  (`src/lib/auth/permissions.ts`), not a database column.
