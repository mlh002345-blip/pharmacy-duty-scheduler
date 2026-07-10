# Verification & False-Positive Filter (Protocols 1–19)

Date: 2026-07-10, same branch (`deploy/postgresql-demo`).

## Scope and method

This is a verification-only pass, not a new sweep. Every finding recorded
in `docs/security/01-*.md` through `docs/security/19-*.md` (protocols
01–17 and 19; there is no `18-*.md` in this repository) was reconstructed
from those documents, merged where two documents describe the same root
cause (e.g. the historical-import and public-duty-request check-then-act
races are each described once in protocol 12 as "fixed with an
application-level dedup check" and again in protocol 13 as "fixed with a
database unique constraint" — these are the same root cause at two points
in its history and are merged into one entry below), and checked against
the current state of the repository: `src/`, `prisma/schema.prisma`,
`prisma/migrations/`, `package.json`/`package-lock.json`,
`tests/`(unit) and `tests/integration/`. No new findings were added, no
fix was implemented, and no source/schema/migration/dependency/test file
was modified in this pass.

For each historical finding, one of three outcomes was reached:

- **CONFIRMED** — a currently reachable issue in the current code, cited
  by file/function.
- **UNVERIFIED** — depends on information not present in this repository
  (Railway dashboard config, a live CVE feed).
- **REJECTED** — disproved by current code: either the finding was
  previously valid and has since been fixed (cited, with the disproving
  file/function/test), or it was never a defect (an intentional design
  choice, already covered by an existing guard, or informational-only).

## CONFIRMED

Sorted by current severity. All of these were already **documented-only**
in their originating protocol (i.e., explicitly identified and
deliberately not fixed, with reasoning given at the time) — this pass
found no new issue and found no previously-documented-only issue to have
silently regressed into something worse than originally described.

### 1. No login rate limiting / lockout

- **Severity:** MEDIUM
- **File/function:** `src/lib/auth/actions.ts`, `loginAction`
- **Current reachable failure:** `loginAction` performs a `prisma.user.findUnique({ where: { email } })` followed by `verifyPassword` with no attempt counter, delay, CAPTCHA, or per-account/per-IP lockout anywhere in the call path. Confirmed by re-reading the full function: no state is read or written outside the `User`/`Session` tables, and no rate-limit helper exists anywhere in `src/lib/`. An attacker with network access to `/giris` can submit unlimited password guesses against any known/guessed email address.
- **Affected actor:** unauthenticated network attacker.
- **Why current controls do not prevent it:** password comparison is constant-time (`timingSafeEqual`) and account-existence enumeration was fixed (protocol 2, item 2), but nothing bounds the *number* of attempts. Originally documented in protocol 02 ("Documented only... explicitly out of scope for this pass") and never subsequently addressed by any later protocol (02–19 reviewed; none touch login throttling).

### 2. `Unavailability` date-range filter has no supporting index

- **Severity:** LOW
- **File/function:** `prisma/schema.prisma`, `model Unavailability` (currently only `@@index([pharmacyId])`, no index covering `startDate`/`endDate`); consumed by `src/lib/scheduling/generate-and-save-duty-schedule.ts` and `src/lib/scheduling/schedule-precheck.ts`, both of which filter `Unavailability` by `startDate: { lte }, endDate: { gte }` on every schedule-generation and pre-check call.
- **Current reachable failure:** re-confirmed the schema still has no `startDate`/`endDate` index on `Unavailability` (unlike `DutyRequest`, which has explicit `@@index([startDate])`/`@@index([endDate])` for the identical filter shape). At low row counts this is invisible; at higher `Unavailability` volume this could force a sequential scan on the hottest write-adjacent path in the app (every schedule generation and every pre-check).
- **Affected actor:** none directly (a performance/scaling risk, not a security issue) — affects operators generating schedules for chambers with a large `Unavailability` history.
- **Why current controls do not prevent it:** no index exists; nothing else in the query path bounds the scan. Originally tagged NEEDS-CONTEXT in protocol 08 ("depends on the real table's row count and Postgres's actual query plan, which isn't visible from the code") and never revisited by a later protocol.

### 3. `editDutyAssignmentAction`'s historical-assignment query is unbounded by date

- **Severity:** LOW
- **File/function:** `src/app/(dashboard)/cizelgeler/[id]/atama/assignment-actions.ts:140-142` — `const otherAssignments = await prisma.dutyAssignment.findMany({ where: { pharmacyId: candidatePharmacyId } });`
- **Current reachable failure:** re-confirmed this query still has no `date` bound; it fetches every `DutyAssignment` a candidate pharmacy has ever had (across all schedules, all time) just to check the `minDaysBetweenDuties` rule against one target date. Cost grows linearly with a pharmacy's total lifetime assignment count.
- **Affected actor:** none directly — a single interactive, staff-triggered action (not a loop, not attacker-reachable at volume), realistic cost is negligible at current per-pharmacy assignment volumes (tens of rows/year) but grows unboundedly over the chamber's lifetime.
- **Why current controls do not prevent it:** no `where: { date: { gte, lte } }` bound exists. Originally documented in protocol 09 ("Left unfixed in this pass... flagged... as worth a `where: { date: { gte, lte } }` bound... whenever this file is next touched") and confirmed the file has not been touched by any later protocol (protocol 13 touched a *different* part of `assignment-actions.ts`'s sibling schedule-transaction code, not this query).

### 4. No password reset lockout / brute-force alerting on the now-logged login-failure events

- **Severity:** LOW
- **File/function:** `src/lib/auth/actions.ts` (`auth_login_failed` warn-level log, added in protocol 16) — nothing consumes its volume.
- **Current reachable failure:** protocol 16 added structured logging of every login failure (`auth_login_failed`), but confirmed (repo-wide search) nothing in this codebase counts, alerts on, or acts on that log stream's volume — it is purely descriptive. This is the same root gap as CONFIRMED item 1 (no rate limiting) viewed from the observability side: an attacker's unlimited guesses are now *visible* in logs but still not *blocked* or *alerted on* automatically.
- **Affected actor:** unauthenticated network attacker (same actor as item 1); operationally, a human or external log tool must notice a pattern manually.
- **Why current controls do not prevent it:** confirmed via protocol 16's own "Remaining limitations" section ("No automated brute-force alerting or rate limiting exists yet") and re-confirmed no later protocol added one.

## UNVERIFIED

### 1. Railway dashboard-configured environment variables and runtime `NODE_ENV`

- **Claim:** the live deployment's actual `DATABASE_URL`, `ADMIN_*` bootstrap values, and whether `NODE_ENV=production` is genuinely set at runtime, as `next build`/`next start`'s documented behavior promises.
- **Why the repo is insufficient:** these values are set entirely in Railway's dashboard/service configuration, which is not part of this git repository and cannot be read from source.
- **Exact context needed:** Railway service → Variables tab for the production environment, plus confirmation that the start command is `next start` (not `next dev`).
- **Conservative risk:** if `DATABASE_URL` were ever wrong or non-Postgres in production, `src/lib/env.ts`'s `validateEnv()` (protocol 14) causes a fail-fast startup crash rather than silent misbehavior — so the app-side mitigation for this blind spot already exists; residual risk is limited to Railway-side misconfiguration this repo cannot see or prevent.

### 2. Reverse-proxy/CDN/TLS-level headers and HSTS

- **Claim:** whether Railway's edge/reverse-proxy adds `Strict-Transport-Security`, additional security headers, or enforces TLS termination in front of the app, beyond the four app-layer headers added in `next.config.ts` (protocol 14).
- **Why the repo is insufficient:** no `railway.json`/`railway.toml`/`Dockerfile`/`nixpacks.toml` exists in this repository (confirmed, repeated check), so Railway's edge configuration is entirely outside the codebase.
- **Exact context needed:** Railway's dashboard/network settings for the production domain, or a live `curl -I` against the deployed URL.
- **Conservative risk:** if Railway's edge does not independently enforce HTTPS, the app itself does not force it either (no HSTS was added, deliberately, per protocol 14's reasoning about irreversibility) — worth confirming before treating HTTPS-only access as guaranteed.

### 3. Live CVE/advisory status for `exceljs@4.4.0`, `pdfkit@0.19.1`, `zod@3.25.76`, `@prisma/client@6.19.3`, `prisma@6.19.3`, `tw-animate-css@1.4.0`

- **Claim:** whether any of these exact pinned versions has a since-published advisory not visible to this repository/session.
- **Why the repo is insufficient:** this session has no live CVE feed / `npm audit` network access beyond what was already run and documented in protocol 15 (which found the six packages above NEEDS-CONTEXT, not confirmed-safe or confirmed-vulnerable).
- **Exact context needed:** `npm audit` (or the GitHub Advisory Database / OSV) run against the exact pinned versions in `package.json`, ideally on a recurring basis, not a one-time check.
- **Conservative risk:** low-to-moderate — all versions are exact-pinned (protocol 15), so no *silent* upgrade can introduce a new, unreviewed vulnerable version; the risk is only that a vulnerability in the *currently pinned* version could exist and go unnoticed without a recurring check.

### 4. Railway's actual dashboard-configured build/install command

- **Claim:** whether Railway actually runs `npm ci` (deterministic) or `npm install` (can silently drift) for the production build.
- **Why the repo is insufficient:** no `railway.json`/`railway.toml`/`Dockerfile`/`nixpacks.toml` exists (confirmed again in this pass); `docs/DEPLOYMENT.md` was fixed to use `npm ci` in its documented sequence (protocol 15), but the repo cannot verify Railway's actual dashboard-configured command matches the documentation.
- **Exact context needed:** Railway service → Settings → Build/Deploy configuration.
- **Conservative risk:** low — `package-lock.json` is committed and consistent (confirmed, protocol 15); the main risk of `npm install` over `npm ci` is a silently-drifted lockfile, which would be visible in a subsequent `git diff` on `package-lock.json` if it ever occurred.

### 5. Three-or-more-way concurrent races and Postgres connection-pool exhaustion

- **Claim:** the new real-Postgres integration suite (`tests/integration/`) proves two-way concurrent races are correctly serialized by the four unique constraints and the advisory-lock guard, and that the `generateAndSaveDutySchedule` transaction rolls back correctly — but does not exercise three-or-more simultaneous operations against the same key, nor behavior under real network partition or connection-pool exhaustion mid-transaction.
- **Why the repo is insufficient:** this is a testing-scope gap explicitly acknowledged in the integration suite's own documentation (`docs/security/19-test-gap-assertion-quality.md`, "Remaining untested risks" under Part B) — not something further static inspection of the current code can resolve; it requires either additional test scenarios or production-scale load observation.
- **Exact context needed:** either a 3+-way integration test scenario (straightforward to add, not done in this pass since this pass makes no code changes) or live Railway metrics under real concurrent load.
- **Conservative risk:** low for this app's actual usage pattern (a small number of named internal chamber-staff accounts, not a high-concurrency public system) — the two-way proof already covers the realistic worst case for this deployment's expected traffic.

## REJECTED

Each entry merges one or more historical findings describing the same
root cause.

---

**Finding/root cause:** Stored XSS via `Pharmacy.mapUrl` accepting `javascript:`/`data:`/`vbscript:` schemes (protocol 01, finding 1).
**Reason:** Previously valid, fixed in current implementation.
**Disproving file/function/test:** `src/lib/validations/safe-url.ts` (`safeHttpUrlSchema`) restricts to `http:`/`https:` only, wired into `src/lib/validations/pharmacy.ts:17` (`mapUrl: z.union([z.literal(""), safeHttpUrlSchema()])`, confirmed present in current source); `src/lib/validations/safe-url.test.ts`.
**Classification:** previously valid but fixed.

---

**Finding/root cause:** Vulnerable `xlsx@0.18.5` (prototype pollution + ReDoS advisories) in the historical-import/export path (protocol 01, finding 2).
**Reason:** Previously valid, fixed in current implementation.
**Disproving file/function/test:** `package.json` no longer lists `xlsx` as a dependency (confirmed via grep, zero matches); `src/lib/historical/parse-excel.ts` and `src/lib/scheduling/build-schedule-excel.ts` use `exceljs@4.4.0` exclusively; `src/lib/historical/parse-excel.test.ts`.
**Classification:** previously valid but fixed.

---

**Finding/root cause:** Excel/CSV formula injection via unescaped string cells in exports (protocol 01, finding 3).
**Reason:** Previously valid, fixed in current implementation.
**Disproving file/function/test:** `src/lib/excel-safety.ts` (`escapeExcelCell`), confirmed called at every `worksheet.addRow(...)` call site in `src/lib/scheduling/build-schedule-excel.ts:67` and `src/app/(dashboard)/gecmis-nobetler/sablon/route.ts:76`; `src/lib/excel-safety.test.ts`.
**Classification:** previously valid but fixed.

---

**Finding/root cause:** Password change did not invalidate existing sessions (protocol 02, finding 1); later found to be non-atomic with the password write itself (protocol 05, findings 2–3).
**Reason:** Previously valid, fixed in current implementation.
**Disproving file/function/test:** `src/app/(dashboard)/kullanicilar/actions.ts`, `updateUserAction` wraps `tx.user.update`, `invalidateUserSessions(id, tx)`, and `writeAuditLog(tx, ...)` in one `prisma.$transaction`; `src/lib/auth/session.ts` (`invalidateUserSessions`, `clearSessionCookie`); tests in `kullanicilar/actions.test.ts`.
**Classification:** previously valid but fixed (merged: protocol 02 fix + protocol 05 atomicity hardening, same root cause).

---

**Finding/root cause:** Inactive-account login message enumeration (protocol 02, finding 2).
**Reason:** Previously valid, fixed in current implementation.
**Disproving file/function/test:** `src/lib/auth/actions.ts`, `loginAction` — confirmed all three failure branches (unknown email, wrong password, inactive account) return the identical string `"Hatalı e-posta veya şifre."`; `src/lib/auth/actions.test.ts`.
**Classification:** previously valid but fixed.

---

**Finding/root cause:** `deleteRegionAction`/`deletePharmacyAction` gated on the STAFF-accessible `manageSetupData` permission instead of an ADMIN-only one (protocol 03, finding 1).
**Reason:** Previously valid, fixed in current implementation.
**Disproving file/function/test:** `src/lib/auth/permissions.ts` — `deleteSetupData` permission confirmed present and granted to `ADMIN` only (line 11, 22); `src/app/(dashboard)/bolgeler/actions.ts`/`eczaneler/actions.ts`'s delete actions use it; `bolgeler/actions.test.ts`, `eczaneler/actions.test.ts`.
**Classification:** previously valid but fixed.

---

**Finding/root cause:** `gecmis-nobetler/sablon/route.ts` had no `hasPermission` check, only login (protocol 03, finding 2).
**Reason:** Previously valid, fixed in current implementation.
**Disproving file/function/test:** `src/app/(dashboard)/gecmis-nobetler/sablon/route.ts` now checks `hasPermission(user.role, "manageSetupData")`; `sablon/route.test.ts`.
**Classification:** previously valid but fixed.

---

**Finding/root cause:** No true IDOR anywhere in the app; public token route correctly scoped; assignment-edit page cross-validates its two URL IDs (protocol 03, findings 3–5).
**Reason:** Never a defect — findings were explicitly "documented only, clean" in the originating audit, not something requiring a fix.
**Disproving file/function/test:** `src/app/eczane-talep/[token]/actions.ts` (`createPublicDutyRequestAction`) confirmed still derives `pharmacyId` only from the server-side token lookup, never client input; `cizelgeler/[id]/atama/[assignmentId]/duzenle/page.tsx` confirmed still checks `assignment.dutyScheduleId !== scheduleId → notFound()`.
**Classification:** false positive (never a defect, audit-clean finding).

---

**Finding/root cause:** `passwordHash` serialized into the browser RSC payload on the user-edit page (protocol 04, finding 1).
**Reason:** Previously valid, fixed in current implementation.
**Disproving file/function/test:** `src/app/(dashboard)/kullanicilar/[id]/duzenle/page.tsx` uses an explicit `select: { id, name, email, role, isActive }`; `UserForm` takes a narrow `EditableUser` DTO; `kullanicilar/[id]/duzenle/page.test.ts`.
**Classification:** previously valid but fixed.

---

**Finding/root cause:** `/denetim-kayitlari` (audit log) readable by any authenticated role, including VIEWER (protocol 04, finding 2).
**Reason:** Previously valid, fixed in current implementation.
**Disproving file/function/test:** `src/app/(dashboard)/denetim-kayitlari/page.tsx` gated by `requirePermissionOrRedirectWithMessage("manageUsers", "/", ...)` (ADMIN-only); `src/lib/nav-items.ts` sidebar entry carries `permission: "manageUsers"`; `denetim-kayitlari/page.test.ts` (strengthened further in protocol 19).
**Classification:** previously valid but fixed.

---

**Finding/root cause:** `prisma/seed.ts` logged plaintext demo passwords to stdout (protocol 04, finding 3).
**Reason:** Previously valid, fixed in current implementation.
**Disproving file/function/test:** `prisma/seed.ts` prints `[redacted demo password]` instead of the literal password value (confirmed by reading the current file's log line).
**Classification:** previously valid but fixed.

---

**Finding/root cause:** Business mutation committed before a separate, non-transactional audit-log write, across ~20 server actions; schedule generation, schedule delete, and historical import already atomic for their own multi-table writes but not yet including the audit log (protocol 05, findings 1, 6–8).
**Reason:** Previously valid, fixed in current implementation.
**Disproving file/function/test:** `src/lib/audit.ts`'s `writeAuditLog(client, params)` requires an explicit Prisma client argument (no silent global-`prisma` default); every action file's mutation + `writeAuditLog(tx, ...)` pair is inside one `prisma.$transaction` (spot-checked: `bolgeler/actions.ts`, `eczaneler/actions.ts`, `kullanicilar/actions.ts`, `cizelgeler/actions.ts`, `gecmis-nobetler/actions.ts`, `generate-and-save-duty-schedule.ts`); confirmed further by this session's own protocol-19 Part B rollback integration test (`tests/integration/schedule-transaction-rollback.integration.test.ts`), which proves against real Postgres that a failure in the audit-log step rolls back the entire `DutySchedule`/`DutyAssignment`/`DutyScheduleWarning` write.
**Classification:** previously valid but fixed.

---

**Finding/root cause:** Concurrent duplicate schedule creation could throw a raw P2002 error page (protocol 05, finding 4).
**Reason:** Previously valid, fixed in current implementation.
**Disproving file/function/test:** `src/app/(dashboard)/cizelgeler/actions.ts`, `createDutyScheduleAction`'s `catch` block maps `P2002` to `duplicateScheduleState`; further proven against real concurrent writes (not just a mocked rejection) by `tests/integration/schedule-uniqueness-concurrency.integration.test.ts` (this session), which launches two genuinely concurrent `generateAndSaveDutySchedule` calls for the same region/year/month and confirms exactly one `DutySchedule` row results and the loser fails with a raw `P2002`.
**Classification:** previously valid but fixed.

---

**Finding/root cause:** Delete-safety-check-then-delete (region/pharmacy) TOCTOU gap between the count check and the delete (protocol 05, finding 5; restated protocol 06).
**Reason:** Claim disproved by an existing guard — the schema's foreign-key `onDelete: Restrict` relations make the race self-healing (a worse error message under the race, not data corruption), and this was explicitly assessed and accepted at the time, not silently missed.
**Disproving file/function/test:** `prisma/schema.prisma` — `Pharmacy.regionId → Region` and `DutyAssignment.pharmacyId → Pharmacy` both confirmed `onDelete: Restrict` in current schema.
**Classification:** framework/guard already prevents it (from corrupting data; the narrower "could surface an ugly error under a true race" residual is retained as accepted, not a security defect, and was not re-raised as its own CONFIRMED item since no protocol treats it as more than a UX nit).

---

**Finding/root cause:** Concurrent admin deactivation could leave zero active admins (protocol 06, finding 1).
**Reason:** Previously valid, fixed in current implementation.
**Disproving file/function/test:** `src/lib/auth/admin-guard.ts`, `assertLastActiveAdminNotRemoved` (Postgres `pg_advisory_xact_lock`), called from inside the same transaction in `updateUserAction`/`setUserStatusAction`; further proven against real concurrent writes by `tests/integration/last-active-admin-concurrency.integration.test.ts` (this session), which launches two genuinely concurrent deactivation calls against exactly two active admins and confirms exactly one succeeds and at least one active admin always remains.
**Classification:** previously valid but fixed.

---

**Finding/root cause:** Manual duty-assignment reassignment could double-book a pharmacy on one date (protocol 06, finding 2).
**Reason:** Previously valid, fixed in current implementation.
**Disproving file/function/test:** `prisma/schema.prisma`, `DutyAssignment @@unique([dutyScheduleId, pharmacyId, date])` (migration `20260708120000_duty_assignment_unique_pharmacy_date`); `editDutyAssignmentAction`'s `catch` maps `P2002` to the friendly message; further proven against real concurrent writes by `tests/integration/duty-assignment-uniqueness-concurrency.integration.test.ts` (this session).
**Classification:** previously valid but fixed.

---

**Finding/root cause:** Duty request could be reviewed twice, second reviewer silently overwrites first (protocol 06, finding 3).
**Reason:** Previously valid, fixed in current implementation.
**Disproving file/function/test:** `src/app/(dashboard)/nobet-talepleri/actions.ts`, `reviewDutyRequestAction` uses a conditional `tx.dutyRequest.updateMany({ where: { id, status: { in: ["PENDING","LATE"] } }, ... })` and checks `count === 0`; `nobet-talepleri/actions.test.ts`.
**Classification:** previously valid but fixed.

---

**Finding/root cause:** Region/User unique-name/email checks raced to a raw P2002; Holiday duplicate date/type had no pre-check at all (protocol 06, findings 4–5).
**Reason:** Previously valid, fixed in current implementation.
**Disproving file/function/test:** `bolgeler/actions.ts`/`kullanicilar/actions.ts` catch `P2002` and return `DUPLICATE_REGION_NAME_STATE`/`DUPLICATE_EMAIL_STATE`; `tatil-gunleri/actions.ts` catches `P2002` and returns the Turkish duplicate-holiday message; corresponding `.test.ts` files for each.
**Classification:** previously valid but fixed.

---

**Finding/root cause:** Blob object URL not revoked on every path in the export button (protocol 07, finding 1).
**Reason:** Previously valid, fixed in current implementation.
**Disproving file/function/test:** `src/components/layout/export-button.tsx`, `downloadBlobAsFile` wraps DOM manipulation in `try { ... } finally { URL.revokeObjectURL(url); } }`; `export-button.test.ts`.
**Classification:** previously valid but fixed.

---

**Finding/root cause:** `/mazeretler` unbounded query + `include: { pharmacy: true }` over-fetch (protocol 08, finding 1).
**Reason:** Previously valid, fixed in current implementation.
**Disproving file/function/test:** `src/app/(dashboard)/mazeretler/page.tsx` confirmed using `skip`/`take` pagination and a scoped `select`; `mazeretler/page.test.ts`.
**Classification:** previously valid but fixed.

---

**Finding/root cause:** `generateDutySchedule` repeated linear scans in the day/pharmacy loop (protocol 09, finding 1).
**Reason:** Previously valid, fixed in current implementation.
**Disproving file/function/test:** `src/lib/scheduling/generate-duty-schedule.ts`, `indexByPharmacyId()` helper builds `Map<pharmacyId, T[]>` indexes once before the day loop (confirmed present); `generate-duty-schedule.test.ts`.
**Classification:** previously valid but fixed.

---

**Finding/root cause:** Dashboard/`/veri-kontrol` re-run the full data-health computation on every load, including an unbounded `Unavailability` full-table load (protocol 09, finding 2; protocol 10, finding 1).
**Reason:** Previously valid, fixed in current implementation.
**Disproving file/function/test:** `src/lib/health/data-health.ts` — `getDataHealthReport()` wraps `fetchDataHealthReport()` in a 60-second module-level TTL cache; the invalid-unavailability lookup uses a fixed, zero-interpolation `prisma.$queryRaw` instead of an unbounded `findMany()`; `get-data-health-report.test.ts`.
**Classification:** previously valid but fixed.

---

**Finding/root cause:** `ExportButton`'s same-origin fetch had no timeout (protocol 11, finding 1).
**Reason:** Previously valid, fixed in current implementation.
**Disproving file/function/test:** `src/components/layout/export-button.tsx`, `fetchExportBlob` uses an `AbortController` + 30s `setTimeout`; `export-button.test.ts`'s `fetchExportBlob` describe block.
**Classification:** previously valid but fixed.

---

**Finding/root cause:** Public duty-request duplicate submit and historical-import duplicate confirm had only an application-level `findFirst`-then-`create` dedup check with a residual concurrent-race window (protocol 12, findings 1–2), later found to be a genuine check-then-act race and fixed with a real database unique constraint (protocol 13, findings 3–4).
**Reason:** Previously valid, fixed in current implementation. (Merged: both protocol documents describe the same root cause at two points in its remediation history — the application-level check from protocol 12 was superseded by the database-level fix in protocol 13, not left in place alongside it.)
**Disproving file/function/test:** `prisma/schema.prisma` — `DutyRequest.dedupKey String? @unique` and `HistoricalDutyImportBatch.fingerprint String? @unique` (migration `20260709090000_idempotency_fingerprint_dedup_key`); `src/app/eczane-talep/[token]/actions.ts` and `src/app/(dashboard)/gecmis-nobetler/actions.ts` both create directly with the unique field set and catch `P2002` — no `findFirst` pre-check remains in either file (confirmed by reading current source: the pre-check `findFirst` calls described in protocol 12 are no longer present). Further proven against real genuinely-concurrent writes (not a mocked rejection) by `tests/integration/public-duty-request-dedup.integration.test.ts` and `tests/integration/historical-import-fingerprint-dedup.integration.test.ts` (this session).
**Classification:** previously valid but fixed (duplicate/merged across protocols 12 and 13).

---

**Finding/root cause:** Balance adjustment duplicate submit had no dedup (protocol 12, finding 3).
**Reason:** Previously valid, fixed in current implementation.
**Disproving file/function/test:** `src/app/(dashboard)/gecmis-nobetler/actions.ts`, `createBalanceAdjustmentAction`'s `prisma.dutyBalanceAdjustment.findFirst` recency-window dedup check (confirmed present, `DUPLICATE_ADJUSTMENT_WINDOW_MS`); `gecmis-nobetler/actions.test.ts`.
**Classification:** previously valid but fixed.

---

**Finding/root cause:** Toggle-status actions (`togglePharmacyStatusAction`/`toggleUserStatusAction`/`toggleRegionStatusAction`) read-then-negated the current DB value, so a double-submit silently cancelled the intended change (protocol 12, finding 4).
**Reason:** Previously valid, fixed in current implementation.
**Disproving file/function/test:** confirmed via grep across `src/` that no `toggle*StatusAction` reference remains anywhere; `setPharmacyStatusAction`/`setRegionStatusAction`/`setUserStatusAction` all take an explicit `isActive: boolean` target parameter (`src/app/(dashboard)/eczaneler/actions.ts`, `bolgeler/actions.ts`, `kullanicilar/actions.ts`); corresponding `.test.ts` files.
**Classification:** previously valid but fixed.

---

**Finding/root cause:** `createPharmacyAction`, admin `createDutyRequestAction`, and `createUnavailabilityAction` have no dedup check for double-submitted creates (protocol 12, documented-only items).
**Reason:** Claim re-verified as still true in current code, but was never presented as something requiring a fix — protocol 12 explicitly left these undone pending a business-key policy decision, not as an oversight. Re-checked in this pass: `src/app/(dashboard)/eczaneler/actions.ts` and `src/app/(dashboard)/mazeretler/actions.ts` still have no `findFirst` dedup check in their create actions (only `findUnique`-by-id in their update/delete paths); `src/app/(dashboard)/nobet-talepleri/actions.ts`'s admin `createDutyRequestAction` still has no dedup check.
**Classification:** duplicate/merged — restated across protocols 12, 13, and 14 as the same unresolved, explicitly-scoped-out item each time; not independently re-raised as a new CONFIRMED finding here because it was never claimed to be fixed and its severity/reasoning (an ambiguous business-key policy is a product decision, not a security gap) is unchanged from the original documented-only assessment. (Note: unlike the items in the CONFIRMED section above, this was consistently treated as "needs a product decision" rather than "should be fixed" in every protocol that touched it — kept out of CONFIRMED to avoid re-litigating a scope decision the repository's own history already made deliberately three times.)

---

**Finding/root cause:** Missing startup-time environment validation for `DATABASE_URL` (protocol 14, finding 6).
**Reason:** Previously valid, fixed in current implementation.
**Disproving file/function/test:** `src/lib/env.ts`, `validateEnv()` runs at module load via `export const env = validateEnv()`; wired into `src/lib/prisma.ts`; `src/lib/env.test.ts`.
**Classification:** previously valid but fixed.

---

**Finding/root cause:** No app-layer security headers configured (protocol 14, finding 7).
**Reason:** Previously valid, fixed in current implementation.
**Disproving file/function/test:** `next.config.ts`'s `headers()` function, confirmed still applying `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy` to every route; `next.config.test.ts`.
**Classification:** previously valid but fixed.

---

**Finding/root cause:** `exceljs`/`pdfkit`/`zod` not exact-pinned; `docs/DEPLOYMENT.md` used `npm install` instead of `npm ci` (protocol 15, findings 4–5).
**Reason:** Previously valid, fixed in current implementation.
**Disproving file/function/test:** `package.json` confirmed exact-pinned (`"exceljs": "4.4.0"`, `"pdfkit": "0.19.1"`, `"zod": "3.25.76"`, no `^`/`~` prefix); `docs/DEPLOYMENT.md`'s build sequence uses `npm ci`.
**Classification:** previously valid but fixed.

---

**Finding/root cause:** Login failures, authorization denials, schedule-generation/historical-import/export failures, and the data-health cache-refresh failure path were all invisible (no logging, no correlation ID) (protocol 16, findings 1–8).
**Reason:** Previously valid, fixed in current implementation.
**Disproving file/function/test:** `src/lib/observability/logger.ts`, `src/lib/observability/request-id.ts`, `src/middleware.ts` (request-ID correlation, confirmed present and confirmed to be request-ID-only, not an auth gate — matches its own documented scope); instrumented call sites confirmed present in `src/lib/auth/actions.ts`, `src/lib/auth/guard.ts`, `cizelgeler/actions.ts`, `gecmis-nobetler/actions.ts`, `eczane-talep/[token]/actions.ts`, both export routes, `data-health.ts`; `logger.test.ts`, `middleware.test.ts`, and the other test files listed in protocol 16's own verification section.
**Classification:** previously valid but fixed.

---

**Finding/root cause:** `sablon/route.ts` had a different error contract (no try/catch) than the two export routes; `createDutyScheduleAction`/`editDutyAssignmentAction` hand-built redirect URLs instead of using `redirectWithMessage`; `deleteBalanceAdjustmentAction` used a hardcoded unauthorized message instead of the shared constant; `reviewDutyRequestAction` hand-built a generic error state instead of using `zodErrorState` (protocol 17, findings 1–4).
**Reason:** Previously valid, fixed in current implementation.
**Disproving file/function/test:** `src/app/(dashboard)/gecmis-nobetler/sablon/route.ts` now has the matching try/catch + `{ message }` 500 contract; `cizelgeler/actions.ts`/`assignment-actions.ts` both confirmed calling `redirectWithMessage` (no hand-built redirect string remains); `gecmis-nobetler/actions.ts`'s `deleteBalanceAdjustmentAction` uses `guard.state.message`; `nobet-talepleri/actions.ts`'s `reviewDutyRequestAction` uses `zodErrorState(parsed.error, ...)`; corresponding tests in each file.
**Classification:** previously valid but fixed.

---

**Finding/root cause:** Every "concurrent duplicate submission" test in the codebase only proved error-message translation against a mocked `P2002`, never a genuine database race (protocol 19 Part A's own stated gap, explicitly deferred to "Part B").
**Reason:** Previously valid, fixed in current implementation — this is the exact gap closed by this session's own work.
**Disproving file/function/test:** `tests/integration/*.integration.test.ts` (6 files, 8 tests, all passing against real PostgreSQL in this session's verification run) — `public-duty-request-dedup`, `historical-import-fingerprint-dedup`, `schedule-transaction-rollback`, `schedule-uniqueness-concurrency`, `duty-assignment-uniqueness-concurrency`, `last-active-admin-concurrency`; `docs/security/19-test-gap-assertion-quality.md`'s own "Part B" section.
**Classification:** previously valid but fixed.

---

**Finding/root cause:** Real authentication bypass in `verifyPassword` — a corrupted `passwordHash` with an invalid-hex key decoded to an empty buffer and trivially matched any password (discovered and fixed during protocol 19 Part A, not present in any earlier protocol).
**Reason:** Previously valid, fixed in current implementation.
**Disproving file/function/test:** `src/lib/auth/password.ts:30` — `if (keyBuffer.length === 0 || keyBuffer.length * 2 !== key.length) return false;` (confirmed present in current source); `src/lib/auth/password.test.ts`'s malformed-hash cases.
**Classification:** previously valid but fixed.

---

**Finding/root cause:** No CORS misconfiguration, no hardcoded secrets, no JWT/signing-secret fallback pattern, no `console.*` logging of sensitive data, no debug endpoints, no over-fetching on public routes, all direct dependencies used and none typosquat-suspicious, no shared in-process mutable state, `DutyRule.upsert` already atomic, Excel/PDF generation in-memory only with no leak, advisory lock is transaction-scoped and leak-free, Prisma client singleton lifecycle correct, historical Excel import analyzer already O(n), public `/vatandas` and `/nobet-dengesi` already request-scoped via `React.cache()` where applicable (protocols 03–11, 14–15, various "Clean" findings).
**Reason:** These were never defects — each was explicitly assessed and found clean in its originating audit, not something later fixed.
**Disproving file/function/test:** re-spot-checked a representative subset in this pass: `package.json` confirmed no `xlsx`; `src/lib/auth/admin-guard.ts` confirmed using `pg_advisory_xact_lock` inside `$transaction`; `prisma/schema.prisma`'s `DutyRule.regionId @unique` confirmed backing the existing `upsert`.
**Classification:** false positive (never a defect; audit-clean findings restated here only to confirm they were correctly merged out of the CONFIRMED list, not overlooked).

## Conclusion

- **CONFIRMED:** 4 total — 0 CRITICAL, 0 HIGH, 1 MEDIUM (no login rate limiting / lockout), 3 LOW (missing `Unavailability` date-range index, unbounded historical-assignment query in `editDutyAssignmentAction`, no brute-force alerting on now-logged login failures).
- **UNVERIFIED:** 5 — Railway dashboard env/runtime config, reverse-proxy/HSTS/TLS configuration, live CVE/advisory status for six pinned dependencies, Railway's actual build/install command, and 3-or-more-way concurrency / connection-pool-exhaustion behavior beyond what the new integration suite proves.
- **REJECTED:** 30 merged historical findings — 27 previously valid and fixed, 3 false positives/audit-clean (never defects).
- **Does any current CRITICAL or HIGH remain?** No. Every finding originally rated HIGH (stored XSS, vulnerable `xlsx`) or structurally severe (concurrent double-booking, zero-active-admin, non-atomic audit writes, unvalidated startup config) across all 19 prior protocols is confirmed fixed in current source, confirmed by an existing regression test, and — where the finding concerned a database-level concurrency guarantee — now additionally confirmed by this session's real-PostgreSQL integration tests, not just a mocked unit test. The 4 items that remain CONFIRMED are MEDIUM/LOW severity, were explicitly documented-only (deliberately deferred, not missed) in their originating protocols, and remain exactly as scoped-out as when first documented.
- **Is the application code-level ready for a controlled pilot?** Yes, with the login rate-limiting gap (CONFIRMED item 1) as the one item worth weighing against the pilot's actual user population before go-live — for a small number of named, internal pharmacist-chamber staff accounts (this app's stated deployment model, not a public signup surface), the practical exploitability is low, but it is the only CONFIRMED item above LOW severity and should be a conscious, documented risk acceptance rather than an oversight if the pilot proceeds without it.
- **Pilot conditions limited to remaining UNVERIFIED deployment/platform items:** before or shortly after go-live, (1) confirm Railway's dashboard `DATABASE_URL`/`NODE_ENV` are correctly set for the production environment — the app will fail fast and loudly if not, per `src/lib/env.ts`; (2) confirm via a live `curl -I` or Railway's network settings whether HTTPS/HSTS is enforced at the edge, since the app itself does not force it; (3) run one `npm audit` (or equivalent) pass against the exact pinned dependency versions before pilot go-live, and periodically thereafter; (4) confirm Railway's actual build command uses `npm ci` per `docs/DEPLOYMENT.md`'s documented sequence. None of these require a code change to begin the pilot — they are configuration confirmations, not blockers, and the app's own fail-fast validation (`src/lib/env.ts`) already catches the most consequential misconfiguration (a bad `DATABASE_URL`) automatically.

## Verification performed

- `npx tsc --noEmit` — clean
- `npm run lint` — clean
- `npm test` — 370/370 passing, unchanged from the pre-existing suite (no test file modified in this pass)
- `npm run test:integration` — 8/8 passing, against a dedicated `TEST_DATABASE_URL` (`pharmacy_duty_scheduler_test`, name-guarded per `tests/integration/helpers/test-db-guard.ts`), distinct from the `DATABASE_URL` used for `npm run build`/`npm test`
- `npm run build` — production build succeeds, all routes registered
- `git status` — before this document was added, the working tree was clean; after adding it, `git diff` contains only this new file (`docs/security/20-verification-false-positive-filter.md`) — confirmed no source, schema, migration, dependency, or test file was changed by this pass
- Current branch: `deploy/postgresql-demo`
