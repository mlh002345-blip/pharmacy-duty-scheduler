# Pilot Deployment Checklist

Operator checklist for deploying/operating the Pharmacy Duty Scheduler
during its controlled pilot phase, per the **CONDITIONAL GO** decision in
`docs/security/28-final-pilot-acceptance.md`. Read that document first
for the full risk register and pilot scope; this is the operational,
step-by-step companion.

## Before deploy

- [ ] Confirm the exact commit hash being deployed matches what was
      verified by `docs/testing/FINAL_PILOT_VERIFICATION.md`'s last
      clean run (re-run that verification sequence if the commit hash
      differs at all).
- [ ] Confirm Railway environment variables are set correctly for the
      target service (`DATABASE_URL` pointing at the intended
      environment, `NODE_ENV=production`).
- [ ] **Confirm `DATABASE_URL` points to the intended production
      database** — not a test/staging/local connection string. This is
      the single most consequential check on this list; verify by
      inspecting the Railway dashboard variable directly, not by
      inference.
- [ ] **Confirm none of `TEST_DATABASE_URL`, `E2E_DATABASE_URL`,
      `PERF_DATABASE_URL`, `CHAOS_DATABASE_URL`, `FILE_TEST_DATABASE_URL`,
      or `RESTORE_DATABASE_URL` are set in the production Railway
      environment** unless intentionally isolated for a specific
      documented purpose — none of this repository's test/chaos/perf/
      file-security tooling should ever be runnable against the
      production service's own environment.
- [ ] **Confirm `TRUST_PROXY_HEADERS` remains unset/`false`** until R-02
      in `docs/security/28-final-pilot-acceptance.md` is separately
      closed by a live proxy-header trust verification
      (`docs/testing/LOGIN_RATE_LIMIT_PROXY_TEST.md`, Section A).
- [ ] Confirm migration status: `npx prisma migrate status` against the
      production `DATABASE_URL` shows no pending migrations before
      deploying code that expects a newer schema; run
      `npm run db:migrate:deploy` (which wraps `prisma migrate deploy`,
      never `migrate dev`) as part of the deploy step if migrations are
      pending.
- [ ] Confirm a recent production database backup exists (Railway's own
      managed backup, or a manual run of `npm run db:backup:production`
      per `docs/testing/BACKUP_RESTORE_REHEARSAL.md`) before any
      migration-bearing deploy.
- [ ] Confirm the restore procedure
      (`docs/testing/BACKUP_RESTORE_REHEARSAL.md`) is understood by
      whoever is on call for the pilot window — local rehearsal has
      passed (R-07 notes a live Railway rehearsal is recommended, not
      yet mandatory, before pilot).
- [ ] Complete R-03's mandatory live check (TLS/redirect/cookie/header
      validation against the real deployed URL,
      `docs/testing/LIVE_HTTPS_COOKIE_HEADER_VALIDATION.md`'s
      "Environment setup" section) before the **first** pilot-triggering
      deploy if not already completed.

## Deploy

- [ ] Deploy the confirmed commit via Railway's normal deploy flow
      (`next build && next start`, per `docs/DEPLOYMENT.md` — no custom
      Dockerfile/Nixpacks config exists in this repository, so Railway's
      default Node.js builder applies).
- [ ] Watch the build logs for the same `npm ci`/`prisma generate`
      sequence verified locally in
      `docs/testing/FINAL_PILOT_VERIFICATION.md`; a build failure here
      that didn't reproduce locally is itself a signal to stop and
      investigate before retrying.
- [ ] If this deploy includes a schema migration, apply it via
      `npm run db:migrate:deploy` as a distinct step before the app
      starts serving the new code (never let `next start` implicitly
      assume the migration already ran).

## Smoke tests (immediately after deploy)

- [ ] **Health check** — load `/` and confirm a real page renders (not
      a Next.js error page or a blank response).
- [ ] **Login/logout check** — using only the seeded demo account
      (`admin@example.com`/`Admin123!` — never a real pilot user's
      credentials for this check), log in, confirm the dashboard loads,
      log out, confirm `/giris` is shown again.
- [ ] **Role check** — confirm at least one non-ADMIN account (STAFF or
      VIEWER) can log in and sees the role-appropriate restricted UI
      (no admin-only controls visible), matching the behavior proven in
      Step 4's 29 E2E tests.
- [ ] **Test export** — as ADMIN, trigger one Excel export and one PDF
      export of an existing (non-sensitive/demo) schedule; confirm both
      downloads succeed and open correctly.
- [ ] **Audit log check** — confirm the login/logout and any test
      mutation performed above produced the expected `AuditLog` entries
      (via `/denetim-kayitlari`), and that no entry contains a password,
      session token, or raw request body.
- [ ] **Rate-limit check without locking real users** — from a
      non-production test account (not the demo account, to avoid
      locking out its usual smoke-test role), submit 2–3 deliberately
      wrong-password attempts and confirm the account/network rate
      limiter's warning threshold behaves as documented in
      `docs/security/21-*.md`, **without** crossing the actual lockout
      threshold against any account real pilot users depend on.
- [ ] **DB connection check** — confirm the app successfully serves
      several concurrent requests without a connection-pool error in
      the logs (Prisma's default pool size is `cpu*2+1`, empirically 9
      in the local test environment — Railway's actual instance sizing
      may differ; watch for pool-exhaustion warnings specifically in
      the first hour after deploy).
- [ ] **Error-log review** — check the deploy's log stream for any of
      the `*_failed`/`*_rejected`/`*_denied`-suffixed structured events
      established across Steps 1–7; an unexpected volume of any of them
      immediately after deploy warrants investigation before continuing.
- [ ] **Response-header spot check when possible** — if a real HTTPS
      request to the live domain is reachable from wherever this
      checklist is being run, spot-check
      `X-Frame-Options`/`X-Content-Type-Options`/`Referrer-Policy`/
      `Permissions-Policy`/`x-request-id` are present (all VERIFIED IN
      CODE per `docs/security/26-*.md`; a live spot-check after each
      deploy catches any accidental regression to `next.config.ts`).

## Monitoring (ongoing during pilot)

See `docs/security/28-final-pilot-acceptance.md`'s "During-pilot
monitoring requirements" section. Summary:

- Watch `excel_resource_limit_exceeded`, `excel_upload_rejected`,
  `auth_login_rate_limited`, `authorization_denied`, and any
  `*_failed` event.
- Watch response times on `/nobet-dengesi` and `/gecmis-nobetler` as the
  pilot chamber's pharmacy count grows (R-05 — unpaginated at scale).
- Weekly spot-check: no `DATABASE_URL`, session token, or row content in
  any log output.

## Incident response

- **Who to contact**: the pilot's designated Eng owner (see the owner
  column in `docs/security/28-final-pilot-acceptance.md`'s risk table
  for area-specific ownership; escalate to Ops for anything
  infrastructure/Railway-specific).
- **First triage step for any suspected security incident**: check the
  structured logs for the relevant event first (never guess from user
  reports alone) — every security-relevant code path in this
  application logs a `requestId`-tagged event with a safe error code,
  per the redaction guarantees established across Steps 1, 7, and 8.
- **If a suspected authentication bypass or data-leak is observed**:
  this is an automatic rollback trigger (see below) — do not attempt a
  live fix under pilot load; roll back first, investigate after.

## Rollback

- **Previous deployment identification**: Railway retains prior
  deploys in its dashboard; identify the last known-good deploy by its
  commit hash (cross-reference against
  `docs/testing/FINAL_PILOT_VERIFICATION.md`'s recorded clean-run commit
  or any later verified commit).
- **Rollback action**: use Railway's dashboard "redeploy previous
  version" action, or redeploy the prior commit hash directly — no
  custom rollback tooling exists in this repository (out of scope for
  this pre-pilot program; a standard Railway redeploy is the mechanism).
- **Schema compatibility check**: before rolling back application code,
  confirm the previous version's expected Prisma schema is still
  compatible with the current database state. This repository's
  migrations are additive-only so far (no destructive migration has
  shipped) — but always check `prisma/migrations/` for the specific
  migrations between the two commits before assuming a plain code
  rollback is safe.
- **When DB restore is required vs. application-rollback only**: if the
  incident involved a schema migration that must itself be reversed
  (not just an application-code regression), a full database restore
  (`docs/testing/BACKUP_RESTORE_REHEARSAL.md`) is required — a plain
  application rollback is insufficient once row-shape assumptions have
  changed. If the incident is purely an application-code defect with no
  schema impact, application rollback alone is sufficient and faster.
- **Incident owner and decision point**: the on-call Eng owner makes the
  rollback-vs-fix-forward call; **default to rollback** for any of the
  automatic-trigger conditions below rather than attempting a live fix
  under pilot load.

### Rollback trigger conditions

- Any observed authentication bypass.
- Any observed partial/duplicate committed data (a violated transaction
  boundary in production).
- Any observed secret, PII, or session-token leak in logs or responses.
- Any sustained application-unavailability not resolved by a simple
  process restart.
- Any reachable-in-production critical/high security advisory
  discovered post-deploy (re-run `npm audit` if a new dependency was
  introduced since the last verified deploy).
