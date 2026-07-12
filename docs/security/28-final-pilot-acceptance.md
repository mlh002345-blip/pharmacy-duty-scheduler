# Final Pilot Acceptance

Date: 2026-07-11, branch `deploy/postgresql-demo`. Pre-pilot test plan,
Step 9 (final step). Updated 2026-07-12 with live Railway evidence and
three header/CSP hardening fixes.

## Executive summary

Nine steps of pre-pilot hardening and validation were performed against
the Pharmacy Duty Scheduler: an injection/authz/secrets/error-handling/
concurrency/resource-leak/performance/logging code sweep (Steps 1–3 and
their companion docs 01–17, 19–20), authentication/session E2E
validation (Step 4), large-data query-plan validation (Step 5),
PostgreSQL chaos/resilience testing (Step 6), Excel/XLSX resource-security
testing (Step 7), a live HTTPS/cookie/header validation (Step 8 — could
not be completed from within this session, but the user separately
obtained real Chrome DevTools evidence against the live Railway
deployment, closing the gap), and a final dependency/advisory/supply-chain
review plus residual-risk consolidation (Step 9). Every fix applied
across all nine steps was evidence-based: a failing input or measured
defect was demonstrated first, the smallest fix was applied, and the
same fixture was re-run to show before/after evidence. Nothing was
fixed speculatively — including this update's three header additions,
each tied to a specific live-confirmed gap and verified locally (real
production build, real browser, zero CSP violations) before being
recorded here.

**Decision: GO.** No blocker-tier finding exists anywhere across all
nine steps, and the live evidence that previously kept this decision at
CONDITIONAL GO (Step 8's TLS/cookie/header validation) has now been
obtained and the two real gaps it surfaced (`Strict-Transport-Security`,
`Content-Security-Policy` absent; `x-powered-by` present) have been
fixed. One deploy-and-spot-check action remains before the fixes
themselves are live-confirmed (see "Mandatory pre-pilot actions") —
this is an ordinary deploy step, not an open risk.

## Scope of Steps 1–9

| Step | Subject | Outcome |
|---|---|---|
| 1–3 | Injection/authz/secrets/error-handling/concurrency/resource-leak/perf/logging code sweep | 2 real fixes applied (XSS `mapUrl`, xlsx→exceljs replacement + formula escaping), rest documented clean or accepted |
| 4 | Role/session E2E validation (real production build, real browser) | 29/29 tests passing; cookie flags, logout, session fixation, expiry all proven against real HTTP |
| 5 | Large-data query-plan validation | Healthy at 50-region/5,000-pharmacy/250,000-row scale; 2 unpaginated tables identified as a scale risk, not a defect |
| 6 | PostgreSQL chaos/resilience testing | 8 scenarios, 18 tests, 4 real observability bugs found and fixed |
| 7 | Excel/XLSX resource-security testing | 1 real defect found and fixed (ZIP-bomb resource exhaustion), 41 tests across 6 spec files |
| 8 | Live HTTPS/cookie/header validation | Could not reach Railway from this session; user obtained live Chrome DevTools evidence separately, confirming everything the app controls survives the real edge; 2 gaps found (missing HSTS/CSP) and fixed, 1 gap found and fixed (`x-powered-by`) |
| 9 | Dependency/advisory/supply-chain review + final consolidation | 4 advisory findings, all confirmed unreachable with source-level evidence; 0 dependency/code changes |

## Final risk table

Severity scale: **CRITICAL** (blocks pilot outright) / **HIGH** (must
close before pilot unless compensating control exists) / **MEDIUM**
(acceptable for a bounded pilot with monitoring) / **LOW** (accepted,
track for general release).

| ID | Severity | Description | Evidence | Affected environment | Pilot impact | Mitigation | Owner | Target timing |
|---|---|---|---|---|---|---|---|---|
| R-01 | LOW | 2 npm audit findings (`postcss` nested in `next`, `uuid` nested in `exceljs`), both moderate severity per npm, both confirmed unreachable by source inspection | `docs/security/27-*.md` | All | None — not reachable by any code path in this app | Re-check on next `next`/`exceljs` upgrade | Eng | Accepted (re-verify on next dependency bump) |
| R-02 | MEDIUM | `TRUST_PROXY_HEADERS` remains unverified against real Railway edge; network-dimension rate limiting is inert until enabled | `docs/security/21-*.md` | Railway production only | Account-dimension rate limiting still fully functional; network-dimension is a blunt shared ceiling only | Complete `docs/testing/LOGIN_RATE_LIMIT_PROXY_TEST.md` Section A against live Railway before enabling the flag | Eng | Before general release; acceptable during a small, monitored pilot |
| R-03 | ~~MEDIUM~~ **CLOSED** | Live TLS/redirect/edge-`Set-Cookie`/edge-HSTS behavior — user obtained real Chrome DevTools evidence against the live Railway deployment: HTTPS loads, `Set-Cookie` flags all correct and survive the edge, logout/re-login cycle the cookie correctly through production. Two real gaps surfaced by that evidence (`Strict-Transport-Security`/`Content-Security-Policy` absent) were fixed this update | `docs/security/26-*.md` | Railway production only | Was the sole item keeping the decision at CONDITIONAL GO; now closed | HSTS + nonce-based CSP added (`next.config.ts`, `src/middleware.ts`, `src/lib/security/csp.ts`), verified locally (real production build + real browser, zero CSP violations, full 29-test E2E suite unchanged) | Eng | **Closed** — one deploy-and-spot-check action remains, see "Mandatory pre-pilot actions" |
| R-04 | ~~MEDIUM~~ **CLOSED (was never a real gap)** | No explicit `Cache-Control` header in the codebase — live evidence shows `Cache-Control: private, no-cache, no-store, max-age=0, must-revalidate` is already present in production, and this update reproduced the identical value in a local production build. Next.js's own default behavior for a fully dynamic, cookie-reading route already provides this — no application code was ever missing anything | `docs/security/26-*.md` | All | None — confirmed correct behavior, not a gap | None needed | Eng | **Closed**, no action |
| R-10 | LOW | `x-powered-by: Next.js` was present live (previously unchecked) — a low-value information-disclosure header | `docs/security/26-*.md` | All | Minimal — framework fingerprinting only, no direct exploit | Fixed this update: `poweredByHeader: false` | Eng | **Closed** — same deploy-and-spot-check as R-03 |
| R-05 | MEDIUM | `/nobet-dengesi` and one `/gecmis-nobetler` view render full, unpaginated result sets; healthy performance was measured at 5,000-pharmacy scale but the rendering pattern itself doesn't bound response size as pharmacy count grows | `docs/security/23-*.md` | All | None at pilot scale (see pilot limits below) | Add real pagination before a chamber's pharmacy count approaches the thousands | Eng | Before general release; not required for the recommended pilot envelope (see Section "Pilot scope") |
| R-06 | LOW | Live Railway managed-restart/network-partition behavior not tested (only local PostgreSQL fault injection was possible) | `docs/security/24-*.md` | Railway production only | Local chaos testing (8 scenarios, all passed) demonstrates correct application-level recovery logic; Railway's own managed-Postgres failover behavior is a platform guarantee outside this repo's control | None needed from application code; confirm Railway's own SLA/backup documentation | Ops | Accepted — platform-level, not application-level |
| R-07 | LOW | Live Railway backup/restore rehearsal deferred (only local restore rehearsal completed) | `docs/testing/BACKUP_RESTORE_REHEARSAL.md` | Railway production only | Local rehearsal proves the restore tooling/procedure itself is correct; only the "does it work against Railway's actual managed Postgres" question remains | Run `docs/testing/BACKUP_RESTORE_REHEARSAL.md`'s procedure against a Railway staging database once available | Ops | Before general release; recommended (not mandatory) before pilot given local rehearsal is strong evidence |
| R-08 | LOW | Two production-distributed dependencies (`buffers`, `png-js`) have no declared license metadata; one (`jszip`) is dual-licensed and this app relies on its MIT election; LGPL-licensed native binaries bundled via `next`'s optional `sharp` image-optimization dependency | `docs/security/27-*.md` | All | No functional/security impact; legal-metadata gap only | Legal review of the three flagged items | Legal | Before general release |
| R-09 | LOW | `@prisma/client`/`prisma` major version 7 and `zod` major version 4 exist but were not adopted (no advisory reason; real migration/compatibility effort) | `docs/security/27-*.md` | All | None — current versions fully functional, exact-pinned, audit-clean at the major version in use | Plan a dedicated future upgrade pass with its own regression validation | Eng | Before general release |

**No CRITICAL or HIGH finding exists in this table.**

## Closed findings

Every finding from Steps 1–7 that had a concrete code-level fix applied
is closed, verified by a regression test, and reconfirmed still passing
in this pass's final verification run (see
`docs/testing/FINAL_PILOT_VERIFICATION.md`):

- XSS via unsanitized `mapUrl` (Step "injection sweep")
- `xlsx` → `exceljs` replacement + formula-injection escaping (Step
  "injection sweep", re-verified end-to-end in Step 7)
- Session invalidation on password change; account-status enumeration
  on login (Step "authentication/session handling")
- `deleteSetupData` permission gate; historical-template route gating
  (Step "authorization/IDOR sweep")
- 4 observability bugs found during chaos testing: missing DB-outage
  logging, pool/lock-timeout event misclassification,
  connection-string leak in an error message, misleading log ordering
  (Step 6)
- ZIP-bomb resource exhaustion in the Excel import path (Step 7)
- Test-harness cleanup FK-ordering bug caught by the file-security
  suite's own cleanup script (Step 7, test infrastructure only)
- Missing `Strict-Transport-Security` and `Content-Security-Policy`,
  and a present `x-powered-by: Next.js` (Step 8 follow-up, this update)
  — all three fixed, verified against a real local production build
  with a real browser and the full E2E suite

## Open findings

See the final risk table above (R-01, R-02, R-05 through R-09). R-03,
R-04, and R-10 are now closed. None of the remaining open items are
blockers; all have an owner and a target timing.

## Pilot decision

### Gate evaluation

**BLOCKER / NO-GO criteria — none present:**
- No reachable critical/high runtime advisory (confirmed: 4 findings,
  all moderate, all confirmed unreachable)
- No known authentication bypass (Step 4: 29/29 E2E tests passing,
  including session fixation, expiry, deactivation)
- No partial transaction commits (Step 6 chaos scenario B, Step 7
  transaction-rollback test: both proven against real PostgreSQL)
- No production secret leakage (Steps 1, 7, 8: repeatedly confirmed no
  stack trace/SQL/DB-URL/token leakage in logs or error responses)
- No uncontrolled upload resource exhaustion (Step 7: ZIP-bomb defect
  found and fixed, with before/after evidence)
- No production DB safety-guard failure (every dedicated test database
  — test/e2e/perf/chaos/filetest/restore — enforces zero fallback to
  `DATABASE_URL`, reconfirmed this pass)
- No unbounded data-corruption risk
- Application recovers after routine DB disruption (Step 6: 8/8 chaos
  scenarios passed)
- No dependency with active exploitation and a reachable code path
  (Step 9: all 4 advisories confirmed unreachable)

**GO criteria — met:**
- No blockers (confirmed above)
- **Live TLS/cookie/header validation completed** — the user's Chrome
  DevTools check against the real Railway deployment directly confirmed
  HTTPS, `Set-Cookie` attributes, and logout/re-login all work correctly
  through the real edge (R-03, now closed)
- Every other unresolved item (R-01, R-02, R-05 through R-09) was
  already scoped, in this document's original risk table, as "before
  general release" or "recommended, not mandatory, before pilot" — none
  were ever a GO-blocking condition for a first pilot
- Monitoring guidance and rollback procedure are defined in
  `docs/operations/PILOT_DEPLOYMENT_CHECKLIST.md`
- Owners and deadlines are assigned in the risk table above

**Remaining condition, not a blocker:** the three header fixes this
update applied (HSTS, CSP, `poweredByHeader: false`) exist in this
branch's code and are verified locally, but have not yet been
live-reconfirmed on Railway — they take effect only once this commit is
deployed. This is an ordinary deploy-and-verify step (already part of
the standard smoke-test checklist's "Response-header spot check"), not
an open risk requiring its own remediation.

### Decision: **GO**

The application is ready for the recommended pilot envelope below.
Deploy this branch's HEAD, then perform the standard post-deploy
smoke-test header spot-check
(`docs/operations/PILOT_DEPLOYMENT_CHECKLIST.md`) to confirm the three
new headers are present live — this is confirmation of an
already-verified fix, not a precondition for the GO decision itself.
General release still requires the separate "before general release"
actions listed below (R-02, R-05, R-07, R-08, R-09).

## Pilot scope recommendation

Distinguishing **measured capacity** (what was actually tested and
found healthy) from **conservative pilot limits** (deliberately set
well below measured capacity for a first controlled rollout):

| Dimension | Measured capacity | Recommended pilot limit | Basis |
|---|---|---|---|
| Regions | 50 (full profile, `docs/security/23-*.md`) | **≤ 5** | Conservative fraction of measured scale; keeps the one pilot chamber's real data volume far below the tested ceiling |
| Pharmacies | 5,000 (full profile) | **≤ 300** | Same rationale; also keeps `/nobet-dengesi`'s unpaginated render (R-05) well within a comfortable page-load size — 300 rows renders instantly, thousands would not |
| Concurrent internal users | Not directly load-tested; connection pool measured at 9 concurrent DB connections by default (Prisma's `cpu*2+1` formula, Step 6) | **≤ 15 concurrent** | Stays well under the measured connection-pool ceiling with headroom for background/export queries |
| Max import file size | 5 MB (enforced, Step 7) | **5 MB** (as enforced — do not raise) | Task explicitly prohibits raising this merely to pass a test; no evidence supports raising it for pilot |
| Max import row count | 5,000 rows (enforced, `MAX_IMPORT_ROWS`, Step 7) | **5,000** (as enforced) | Same — measured benchmark at exactly this limit: ~150ms parse, single-digit-MB memory delta |
| Supported browser baseline | Chromium (tested), production build | **Evergreen Chromium/Firefox/Edge** (untested on Safari/older browsers) | E2E suite only exercises Chromium; no cross-browser matrix was run in any step |
| Permitted user roles | ADMIN, STAFF, VIEWER (all three role-tested, Step 4) | **All three**, ADMIN count kept small (≤ 3) | Role-based authorization fully E2E-validated for all three |
| Public `/vatandas` access | Tested, public-safe field selection confirmed (Step "secrets exposure") | **Enabled** | No over-fetching found; public route is safe |
| Historical import | Tested extensively (Step 7) | **Enabled**, within the 5MB/5,000-row limits | Fully validated including malicious-fixture rejection, formula-injection neutralization, transaction rollback |
| Exports (Excel/PDF) | Tested (Step 7 for Excel; PDF export route exists but wasn't part of the XLSX-specific resource-security sweep since it doesn't parse XLSX) | **Enabled** | Formula-injection neutralization verified end-to-end |
| Live customer data | R-03 (live TLS/cookie check) is now closed | **Permitted**, once this commit (with the HSTS/CSP/`poweredByHeader` fixes) is deployed and the post-deploy header spot-check confirms them live | R-03's live evidence directly confirmed HTTPS/cookie integrity through the real edge; the header fixes it justified are verified locally and pending only an ordinary deploy |
| Rollback trigger conditions | See `docs/operations/PILOT_DEPLOYMENT_CHECKLIST.md` | — | — |

## Mandatory pre-pilot actions

1. **Deploy this branch's HEAD to Railway** (includes the HSTS/CSP/
   `poweredByHeader` fixes) and perform the standard post-deploy
   "Response-header spot check" from
   `docs/operations/PILOT_DEPLOYMENT_CHECKLIST.md`'s smoke tests —
   confirm `Strict-Transport-Security` and `Content-Security-Policy` are
   now present live, and `x-powered-by` is gone. This is verification of
   an already-locally-proven fix, not new remediation work.
2. Confirm `TRUST_PROXY_HEADERS` is `false`/unset in the Railway
   environment (it must remain so until R-02 is separately closed).
3. Confirm a Railway database backup exists and the restore procedure
   (`docs/testing/BACKUP_RESTORE_REHEARSAL.md`) is understood by whoever
   is on call during the pilot, even though a live Railway restore
   rehearsal itself is R-07 (recommended, not mandatory, before pilot).
4. Run the full command sequence in
   `docs/testing/FINAL_PILOT_VERIFICATION.md` one more time immediately
   before the deploy that starts the pilot, to catch any drift since
   this document was written.

## During-pilot monitoring requirements

- Watch for `excel_resource_limit_exceeded`, `excel_upload_rejected`,
  `auth_login_rate_limited`, `authorization_denied`, and any
  `*_failed`-suffixed structured log event (all established in Steps
  1–7) — these are the events designed to surface abuse or
  misconfiguration without leaking sensitive detail.
- Watch actual response times/error rates on `/nobet-dengesi` and
  `/gecmis-nobetler` as pharmacy count grows toward the pilot limit
  (R-05) — this is the one scale-sensitive area within the recommended
  pilot envelope.
- Confirm no `DATABASE_URL`, session token, or row content appears in
  any log output during the pilot (spot-check weekly).

## Pre-general-release actions

- Close R-02 (live proxy-header trust verification) before enabling
  `TRUST_PROXY_HEADERS=true`.
- Close R-05 (real pagination for `/nobet-dengesi` and the affected
  `/gecmis-nobetler` view) before chamber pharmacy counts approach the
  thousands.
- Close R-07 (live Railway backup/restore rehearsal).
- Resolve R-08 (legal review of the three flagged license items).
- Revisit R-09 (major-version dependency upgrades) as a dedicated,
  separately-validated pass.

## Rollback criteria

See `docs/operations/PILOT_DEPLOYMENT_CHECKLIST.md`'s "Rollback"
section for the full procedure. Summary triggers: any authentication
bypass observed, any partial/duplicate committed data observed in
production, any secret/PII leak observed in logs or responses, or any
sustained application-unavailability not resolved by a simple restart.
