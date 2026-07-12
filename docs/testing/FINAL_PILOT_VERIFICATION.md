# Final Pilot Verification

Step 9 (final step) of the pre-pilot infrastructure and security test
plan. This is the single command sequence that should be run before any
pilot-triggering deploy, and was run in full during this pass with the
results recorded below. Updated 2026-07-12: re-run after the Step 8
header/CSP follow-up (HSTS, nonce-based Content-Security-Policy,
`poweredByHeader: false`) added 14 new tests (`next.config.test.ts`
extended, `src/middleware.test.ts` extended, new
`src/lib/security/csp.test.ts`) and the full E2E suite was re-run
against the changed `next.config.ts`/`src/middleware.ts` (production
build, CSP active) with zero regressions.

## Environment requirements

- Node.js `v22.22.2`, npm `10.9.7` (or compatible — see `package.json`
  for any future `engines` constraint; none is currently declared).
- A local (or otherwise dedicated, non-production) PostgreSQL 16+
  instance reachable as a role with `CREATEDB`/`CREATE TRIGGER`
  permissions, with **seven** dedicated databases already migrated:
  the main `DATABASE_URL` target plus six guarded test databases
  (`TEST_DATABASE_URL`, `E2E_DATABASE_URL`, `PERF_DATABASE_URL`,
  `CHAOS_DATABASE_URL`, `FILE_TEST_DATABASE_URL`, `RESTORE_DATABASE_URL`).
  None of these six may ever equal `DATABASE_URL` — every guard in this
  repository rejects that condition before running anything.
- `PLAYWRIGHT_BROWSERS_PATH`/`PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD` set
  appropriately if Chromium isn't at Playwright's default cache path
  (this environment uses `/opt/pw-browsers/chromium` via
  `playwright.config.ts`'s `launchOptions.executablePath`).
- Outbound access to `registry.npmjs.org` for `npm ci`/`npm audit`.

## Exact verification commands (run in this order)

```bash
node --version
npm --version
npm ci
npx prisma validate
npx prisma generate
npx prisma migrate status
npx tsc --noEmit
npm run lint
npm test
npm run test:preflight
npm run test:integration
npm run test:e2e
npm run test:perf:preflight
npm run test:chaos:preflight
npm run test:file:preflight
npm run build
npm audit
npm audit --omit=dev
```

Per the task's explicit instruction, the **full** `test:perf`,
`test:chaos`, and `test:file` suites (as opposed to their `:preflight`
checks) are **not** rerun in this sequence unless a code or dependency
change in that pass actually touches the area they cover — Step 9 made
no dependency or application-code change, so only the three
preflight/guard checks were run to confirm the guarded databases remain
reachable and migrated. See `docs/testing/DB_RESILIENCE_CHAOS_TEST.md`,
`docs/testing/LARGE_DATA_QUERY_PLAN_TEST.md`, and
`docs/testing/EXCEL_XLSX_RESOURCE_SECURITY_TEST.md` for those full
suites' own last-recorded clean-run evidence (Steps 5–7).

## Test counts and results (this pass's clean run)

| Command | Result |
|---|---|
| `node --version` | `v22.22.2` |
| `npm --version` | `10.9.7` |
| `npm ci` | 563 packages installed, deterministic (zero `package-lock.json` mutation, confirmed via `git status`) — run twice this pass, once with `--ignore-scripts` and once normally |
| `npx prisma validate` | `The schema at prisma/schema.prisma is valid` |
| `npx prisma generate` | `Generated Prisma Client (v6.19.3)` in 221ms |
| `npx prisma migrate status` | `Database schema is up to date!` (7 migrations, target `pharmacy_duty_scheduler`) |
| `npx tsc --noEmit` | Clean, zero errors |
| `npm run lint` | Clean, zero errors/warnings |
| `npm test` | **52 test files, 603 tests passing** (589 + 14 new: CSP/HSTS/`poweredByHeader` unit and middleware tests) |
| `npm run test:preflight` | Guard PASSED against `pharmacy_duty_scheduler_test`, schema up to date |
| `npm run test:integration` | **7 test files, 13 tests passing** |
| `npm run test:e2e` | **29/29 Playwright tests passing** (real Chromium, real production build, real local PostgreSQL) |
| `npm run test:perf:preflight` | Guard PASSED against `pharmacy_duty_scheduler_perf`, schema up to date |
| `npm run test:chaos:preflight` | Guard PASSED against `pharmacy_duty_scheduler_chaos`, schema up to date |
| `npm run test:file:preflight` | Guard PASSED against `pharmacy_duty_scheduler_filetest`, schema up to date |
| `npm run build` | Succeeds — 34 routes built (33 dynamic, 1 static `/_not-found`), no errors |
| `npm audit` | 4 moderate findings, 0 critical/high/low — all 4 triaged as **NOT REACHABLE** in `docs/security/27-*.md` |
| `npm audit --omit=dev` | Identical 4 findings (same set is reachable from the production subtree) |

**Total automated test count across the full program**: 603 (`npm test`,
which already includes the perf/seed pure-unit tests and this update's
14 new CSP/HSTS tests) + 13 (integration) + 29 (E2E) + 18 (chaos suite,
`tests/chaos/**` — excluded from `npm test`, last executed in full
during Step 6) + 41 (file-security suite, `tests/file-security/**` —
excluded from `npm test`, last executed in full during Step 7) = **704
distinct automated tests**, none
double-counted (each suite's `vitest.config.ts`/dedicated config
excludes the others' test directories). The chaos and file-security
suites were not rerun in full during this pass since Step 9 made no
code or dependency change affecting them — only their `:preflight`
guard checks were rerun, per the table above.

## Known environment-specific limitations

- This verification was run in a sandboxed session environment with a
  policy-restricted egress proxy — `npm ci`/`npm audit` succeeded
  because `registry.npmjs.org` is allow-listed, but the live Railway
  production domain is not (see `docs/security/26-*.md`). No command in
  this sequence touches Railway; all are local-only or registry-only.
- `npm run test:e2e` binds to `localhost:3210` for its own production
  build and requires that port free; `reuseExistingServer: false`
  ensures it fails fast rather than silently attaching to an unrelated
  process if the port is occupied.
- PostgreSQL must be started (`service postgresql start` in this
  sandbox) before any command that touches a database — this is
  environment setup, not part of the verification sequence itself.

## Final clean-run evidence (this pass)

All commands above were executed in sequence on 2026-07-11 against
branch `deploy/postgresql-demo`, and all passed with the results in the
table above. `git status --porcelain` was clean immediately before this
sequence began (aside from the in-progress Step 9 documentation files
being written) and after every `npm ci` invocation within it. No
production database (`DATABASE_URL` in this environment always points
to the local `pharmacy_duty_scheduler` database, never a Railway
connection string) was touched by any command in this sequence.
