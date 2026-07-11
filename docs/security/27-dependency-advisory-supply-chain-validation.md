# Dependency / Advisory / Supply-Chain Validation

Date: 2026-07-11, branch `deploy/postgresql-demo`, HEAD `dadfe9a` at the
start of this pass. Pre-pilot test plan, Step 9.

## Scope

This pass had **live `npm audit`/registry access** (via the session's
egress proxy to `registry.npmjs.org`), closing the explicit
"NEEDS-CONTEXT" gap left open by the earlier
`docs/security/15-dependency-supply-chain-review.md` pass (2026-07-09),
which had no live CVE feed access and could only flag
`exceljs`/`pdfkit`/`zod`/`@prisma/client`/`prisma`/`tw-animate-css` for a
future live check. This document performs that check, plus a full
license/supply-chain review neither prior pass covered. It does not
repeat findings from doc 15 that remain unchanged (all direct
dependencies used, no typosquats, expected install scripts only) —
those are reconfirmed below only where new evidence adds to them.

## Baseline

- Branch: `deploy/postgresql-demo`
- HEAD at start of this pass: `dadfe9a`
- Node.js: `v22.22.2`
- npm: `10.9.7`
- Next.js: `16.2.10` (exact-pinned; this is the latest published version)
- React / React DOM: `19.2.4` (exact-pinned; latest is `19.2.7`, a patch behind)
- Prisma / `@prisma/client`: `6.19.3` (exact-pinned; latest major is `7.8.0`)
- PostgreSQL (local): `16.13` (Ubuntu build)
- `package-lock.json` `lockfileVersion`: `3`
- Direct runtime dependencies: **15**
- Direct dev dependencies: **14**
- Total resolved packages in lockfile (`packages` map, excl. root): **678**
- `npm ls --all` reports **190** prod, **453** dev, **138** optional (overlap: a package can count in multiple categories), **678** total unique tree entries
- Working tree confirmed clean (`git status --porcelain`) before this pass began, and again before every commit in this pass

## Dependency inventory

| Package | Installed | Range | Exact-pinned | Classification | Executes in prod | Untrusted input | Native/install scripts |
|---|---|---|---|---|---|---|---|
| `next` | 16.2.10 | exact | yes | runtime-critical | yes | yes (all HTTP input) | no (own transitive `sharp` does, optional image codec) |
| `react` | 19.2.4 | exact | yes | runtime-critical | yes | no | no |
| `react-dom` | 19.2.4 | exact | yes | runtime-critical | yes | no | no |
| `@prisma/client` | 6.19.3 | exact | yes | database-related | yes | yes (via app queries) | yes (engine fetch/codegen, standard) |
| `prisma` (CLI) | 6.19.3 | exact | yes (devDependency) | database-related, build-only | no (CLI only) | no | yes (standard) |
| `exceljs` | 4.4.0 | exact | yes | export/import-related | yes | yes (uploaded XLSX) | no |
| `jszip` | 3.10.1 | exact | yes | export/import-related | yes | yes (ZIP-preflight reads uploaded bytes) | no |
| `pdfkit` | 0.19.1 | exact | yes | export/import-related | yes | no (server-generated content only) | no |
| `zod` | 3.25.76 | exact | yes | authentication/security-related (validates all Server Action input) | yes | yes | no |
| `@radix-ui/react-label` | ^2.1.11 | caret | no | UI-only | yes | no | no |
| `@radix-ui/react-separator` | ^1.1.11 | caret | no | UI-only | yes | no | no |
| `@radix-ui/react-slot` | ^1.3.0 | caret | no | UI-only | yes | no | no |
| `class-variance-authority` | ^0.7.1 | caret | no | UI-only | yes | no | no |
| `clsx` | ^2.1.1 | caret | no | utility | yes | no | no |
| `lucide-react` | ^1.23.0 | caret | no | UI-only | yes | no | no |
| `tailwind-merge` | ^3.6.0 | caret | no | UI-only | yes | no | no |
| `tw-animate-css` | ^1.4.0 | caret | no | UI-only (CSS-only, no JS) | yes | no | no |
| `@faker-js/faker` | ^10.5.0 | caret | no | test-only | no | no | no |
| `@playwright/test` | 1.61.1 | exact | yes | test-only | no | no | yes (browser fetch; skipped in this env per `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD`) |
| `@tailwindcss/postcss` | ^4 | caret | no | build-only | no | no | no |
| `@types/*` (node, pdfkit, react, react-dom) | various | caret | no | build-only (types) | no | no | no |
| `eslint` | ^9 | caret | no | build-only | no | no | no |
| `eslint-config-next` | 16.2.10 | exact | yes | build-only | no | no | no |
| `tailwindcss` | ^4 | caret | no | build-only | no | no | no |
| `tsx` | ^4.23.0 | caret | no | build-only (script runner) | no | no | no |
| `typescript` | ^5 | caret | no | build-only | no | no | no |
| `vitest` | ^4.1.10 | caret | no | test-only | no | no | no |

**Password hashing**: no third-party package — `src/lib/auth/password.ts`
uses Node's built-in `node:crypto` `scrypt` (via `promisify`), confirmed
unchanged from the earlier pass.

**Maintenance status / last-published check** (live registry query, this
pass):

| Package | Latest available | Currently installed | Last publish (installed version) | Notes |
|---|---|---|---|---|
| `exceljs` | 4.4.0 | 4.4.0 (current = latest) | 2023-10-19 | A `4.4.1-prerelease.0` exists (2024-12-20) but was never promoted to a stable release — not adopted |
| `pdfkit` | 0.19.1 | 0.19.1 (current = latest) | 2026-06-10 | Actively maintained (59 published versions); resolves doc 15's "worth checking upstream maintenance activity" flag — **not abandoned** |
| `zod` | 3.25.76 in the `3.x` line; `4.x` line exists separately | 3.25.76 (current = latest 3.x) | 2025-07-08 | Deliberately staying on the `3.x` line — a `4.x` major exists but is out of scope for this pass (see Section "Dependency upgrade policy") |
| `jszip` | 3.10.1 (current = latest) | 3.10.1 | 2022-08-02 | Older publish date but still the maintained latest release; no newer version exists to move to |
| `@prisma/client` / `prisma` | 6.19.3 (current = latest 6.x); `7.8.0` exists as a new major | 6.19.3 | — | Major version out of scope this pass (no advisory-driven reason) |
| `tw-animate-css` | 1.4.0 (current = latest) | 1.4.0 | 2025-09-24 | Actively maintained; resolves doc 15's "smaller/newer package" flag |
| `next` | 16.2.10 (current = latest) | 16.2.10 | — | Already latest; no upgrade path exists |

No package in this table shows an npm-reported deprecation notice on
the direct dependency itself.

## `npm audit` results

Ran with live registry access (`npm audit --json`, `npm audit --omit=dev --json`).
**Identical result set in both modes** — meaning every finding is
already reachable from the production dependency subtree, not purely a
dev-only concern:

```
{ "info": 0, "low": 0, "moderate": 4, "high": 0, "critical": 0, "total": 4 }
```

Full sanitized JSON output saved under the gitignored
`dependency-review-output/` directory (`audit-full.json`,
`audit-prod.json`) — not committed, per the task's constraint against
committing generated artifacts; this document is the committed summary.

## Advisory triage

| # | Package | Direct/transitive | Runtime/dev | Severity | Reachable? | Untrusted input reaches it? | Bundled in prod? | Fixed version available | Fix = major bump? | Recommended action |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `postcss` (nested inside `next@16.2.10`'s own `node_modules/next/node_modules/postcss@8.4.31`) | Transitive (via `next`) | Runtime (bundled in `next`'s own build tooling) | Moderate — [GHSA-qx2v-qp2m-jg93](https://github.com/advisories/GHSA-qx2v-qp2m-jg93), XSS via unescaped `</style>` in CSS Stringify Output, CVSS 6.1 | **NOT REACHABLE** | No — PostCSS in this app only ever processes this repository's own authored Tailwind CSS at build time (`next build`); no code path feeds user-supplied/untrusted CSS content into PostCSS at runtime, which is the precondition for this advisory | Yes (bundled as part of `next`'s internal build tooling), but only exercised during `next build`, never per-request at runtime | None — `next@16.2.10` is already the latest published version and pins this internal postcss copy at exactly `8.4.31`; no newer `next` release exists to move to | N/A (no fix available upstream) | **ACCEPT FOR PILOT / NOT REACHABLE** |
| 2 | `next` (flagged because its own dependency tree includes the vulnerable nested postcss above) | Direct | Runtime | Moderate | **NOT REACHABLE** (same underlying issue as #1) | No | Yes | None — already latest | N/A | **ACCEPT FOR PILOT / NOT REACHABLE** |
| 3 | `uuid` (transitive via `exceljs@4.4.0`) | Transitive | Runtime (bundled) | Moderate — [GHSA-w5hq-g745-h8pq](https://github.com/advisories/GHSA-w5hq-g745-h8pq), missing buffer bounds check in `uuid` v3/v5/v6 **when a `buf` argument is explicitly provided by the caller**, CVSS 7.5 | **NOT REACHABLE** — confirmed by direct source inspection, not inference | No — `exceljs`'s only use of `uuid` is a single call site (`node_modules/exceljs/lib/xlsx/xform/sheet/cf-ext/cf-rule-ext-xform.js`), which imports only `{v4: uuidv4}` and calls `uuidv4()` with **zero arguments** in both usages. The vulnerable code path requires `v3`, `v5`, or `v6` to be called **with** a `buf` option — a function/parameter this codebase's dependency tree never invokes | Yes (bundled), but the vulnerable function signature is never called | None — `exceljs@4.4.0` is already latest; npm's suggested "fix" (`exceljs@3.4.0`) is a major-version **downgrade** to a much older release, not a real remediation path | Yes (proposed fix is a major downgrade, and a nonsensical one) | **NOT REACHABLE** (source-verified, not merely "transitive so ignored") |
| 4 | `exceljs` (flagged because it depends on the vulnerable `uuid` range) | Direct | Runtime | Moderate | **NOT REACHABLE** (same underlying issue as #3) | No | Yes | None — already latest | N/A | **ACCEPT FOR PILOT / NOT REACHABLE** |

**No `FIX NOW` or `BLOCK PILOT` findings.** All four resolve to the same
two underlying issues (a vendored build-time-only `postcss` copy inside
`next`, and an unreachable `uuid` code path inside `exceljs`), both
already at their latest available upstream version with no non-major
remediation path, and both independently confirmed not reachable by any
code path this application actually exercises — not dismissed on
severity or "it's transitive" grounds alone. `npm audit fix --force`
was **not** run (would force `next` and `exceljs` to years-old major
versions, explicitly prohibited by the task and not warranted by
unreachable findings).

## Lockfile and supply-chain checks

| Check | Result |
|---|---|
| `package-lock.json` committed | Yes |
| `package.json`/`package-lock.json` synchronized | Yes — `npm ci` (both `--ignore-scripts` and normal) completed with zero lockfile mutation (`git status` clean before and after both runs) |
| `npm ci` succeeds from clean state | Yes, twice (once `--ignore-scripts`, once normal) — `563` packages added each time, deterministic |
| Lockfile integrity hashes present | `672` of `678` package entries carry an `integrity` field; the 6 missing are all nested inside the optional, **not-installed-on-this-platform** `@tailwindcss/oxide-wasm32-wasi` bundle (confirmed via `node_modules/@tailwindcss/` listing — only the `linux-x64-gnu`/`linux-x64-musl` variants are actually present) |
| Git/URL/file dependencies | **Zero** — every resolved package comes from `registry.npmjs.org` |
| Wildcard dependency versions | None found in `package.json` (every range is `^x.y.z`, an exact version, or `*` was not used anywhere) |
| Unexpected prerelease dependencies | Two found in the full tree: `gensync@1.0.0-beta.2` and `resolve@2.0.0-next.7` — both are long-standing, widely-deployed transitive build-tooling dependencies (Babel/webpack-adjacent resolution helpers) whose "-beta"/"-next" tag has been their de facto stable release identifier for years; neither is a direct dependency, neither has any known advisory |
| Dependency-confusion risk (private-looking names) | None — no `@internal/`, no unscoped name resembling an org-private package; all scopes (`@radix-ui`, `@prisma`, `@tailwindcss`, `@types`, `@faker-js`, `@img` (sharp's platform binaries), `@noble` (pdfkit's crypto deps)) are well-known public scopes |
| Lifecycle scripts from suspicious packages | 8 packages carry an install script tree-wide: `@prisma/client`, `@prisma/engines`, `prisma` (all Prisma's own standard engine-fetch/codegen), `esbuild` (native binary fetch, standard for any esbuild-based toolchain — pulled in transitively by Vitest/Tailwind tooling), `fsevents` (macOS-only native file watcher, inert on this Linux environment, standard optionalDependency pattern), `sharp` (native image codec, optional transitive dependency of `next` for image optimization), `unrs-resolver` (native TS-resolution helper, transitive dev dependency of `eslint-config-next`). All are well-known, widely-audited packages performing exactly their documented function — none unexpected |
| Uncommitted lockfile mutation after `npm ci` | None — confirmed via `git status --porcelain` immediately after both `npm ci` runs |
| Duplicate versions materially expanding attack surface | 27 package names resolve to 2–3 versions each in the tree (e.g. `semver`, `debug`, `minimatch`, `ignore`, `postcss`, `readable-stream`) — all are small, non-security-critical utility libraries duplicated because different tools in the dev/build toolchain pin different minor versions; `npm dedupe --dry-run` confirms this is normal tree shape (would collapse ~10 duplicates and add ~18 currently-unused optional platform binaries for other OS/arches). **Not actioned** — the task explicitly says not to remove duplicates without proven compatibility, and none of these 27 represent a materially different attack surface (no two conflicting versions of a security-critical package like a crypto/TLS library) |
| Non-default registry sources | None — `npm config get registry` returns `https://registry.npmjs.org/` (the default); no `.npmrc` file exists in the repository |

**Deprecated packages** (npm install-time warnings, all transitive, all
non-vulnerable per `npm audit`): `inflight@1.0.6`, `rimraf@2.7.1`,
`lodash.isequal@4.5.0`, `glob@7.2.3`, `fstream@1.0.12`, `uuid@8.3.2` —
every one of these traces back through `exceljs@4.4.0`'s own
`archiver`/`unzipper`/`fast-csv` dependency chain (confirmed via `npm ls
<pkg> --all`). `exceljs` is already at its latest published version, so
these cannot be resolved without replacing the library entirely — not
warranted, since (a) `npm audit` reports zero advisories against any of
them, and (b) Step 7 already established `exceljs` is safely bounded via
the application's own ZIP-metadata preflight layer regardless of its
internal dependency freshness.

## Unused and duplicate dependency review

Every one of the 15 direct runtime dependencies and 14 direct dev
dependencies has confirmed real usage — reconfirmed this pass via
grep-based import analysis plus explicit checks for the three
config-only packages that a plain `import`/`require` grep would miss:

- `tw-animate-css` — CSS-only `@import "tw-animate-css";` in
  `src/app/globals.css` (0 JS imports, correctly so)
- `@tailwindcss/postcss` — referenced in `postcss.config.mjs`'s
  `plugins` object (0 JS imports, correctly so)
- `eslint-config-next` — referenced in `eslint.config.mjs`
- `tsx` — invoked 17 times across `package.json`'s own `scripts` (never
  imported in application code, correctly so, since it's a CLI runner)

No unused direct dependency found, no removal made. No duplicate
libraries serving the same purpose exist among direct dependencies
(e.g. only one XLSX library, one PDF library, one validation library).

## License findings

Full machine-readable inventory (678 packages) written to the gitignored
`dependency-review-output/license-inventory.json`. Distribution summary:

| License family | Count |
|---|---|
| MIT | 549 |
| Apache-2.0 | 46 |
| ISC | 30 |
| MPL-2.0 | 13 |
| LGPL-3.0-or-later | 10 |
| BSD-2-Clause / BSD-3-Clause | 13 |
| Apache-2.0 AND LGPL-3.0-or-later (combinations) | 4 |
| 0BSD, MIT/X11, BlueOak-1.0.0, Python-2.0, Unlicense, CC-BY-4.0, CC0-1.0, MIT AND Zlib | 1 each |
| `(MIT OR GPL-3.0-or-later)` (dual-licensed) | 1 |
| **UNKNOWN / missing license metadata** | 2 |

**Flagged for legal review** (technical metadata only — no legal
conclusion asserted):

1. **`jszip@3.10.1`** — dual-licensed `(MIT OR GPL-3.0-or-later)`. This
   application uses it under the **MIT** election (the standard choice
   for MIT-compatible consumption; no GPL obligation applies as long as
   MIT terms are the one relied upon). Flagged so legal review can
   confirm this election is acceptable and, if desired, record it
   explicitly.
2. **`@img/sharp-libvips-*` (10 platform-specific native-binary
   packages, transitive/optional via `next`'s optional `sharp`
   dependency for image optimization) and `@img/sharp-wasm32`/
   `sharp-win32-*`** — `LGPL-3.0-or-later` (some combined with
   Apache-2.0/MIT for the wrapper code). LGPL is a weak-copyleft license
   widely used for bundled native libraries (libvips is the de facto
   standard image-processing backend for `sharp`, used across the
   Node.js ecosystem including by Next.js itself) — flagged for legal
   review, not because it is unusual, but because LGPL is the only
   copyleft-family license found among production dependencies.
3. **`buffers@0.1.1`** (transitive via `exceljs` → `unzipper` →
   `binary`) and **`png-js@1.1.0`** (transitive via `pdfkit`) — both
   ship **no `license` field at all** in their published `package.json`
   (confirmed by reading the installed package's own `package.json`
   directly, not just the lockfile). This is a metadata gap in the
   upstream packages themselves; this review does not assert what
   license actually governs them (their public repositories may state
   one) — flagged as UNKNOWN pending legal review, not resolved here.

No production dependency uses AGPL or SSPL. All dev-only tooling
(Playwright, Vitest, ESLint, TypeScript, Tailwind, faker) is excluded
from production distribution by definition (never bundled into
`next build`'s output) and is licensed MIT/Apache-2.0/BSD throughout —
no flags there.

## Security configuration consolidation (Steps 1–8, current status)

Re-stated here for Step 9's single point of reference — none of these
are reopened or re-litigated; each links to its original evidence:

| Area | Status | Evidence |
|---|---|---|
| Environment-variable validation | Verified — `src/lib/env.ts` validates `NODE_ENV`/`DATABASE_URL` at startup | Step "Configuration & Environment Hardening" (`docs/security/14-*.md`) |
| Secret handling | Verified — no hardcoded secrets, no `SESSION_SECRET` needed (DB-backed opaque tokens) | `docs/security/04-*.md` |
| Session-cookie configuration | Verified in code + locally (production build E2E) | `docs/security/02-*.md`, `docs/security/26-*.md` |
| Password hashing | Verified — Node built-in `scrypt`, no third-party dependency | `docs/security/02-*.md`, this doc's inventory above |
| Login rate limiting | Verified — PostgreSQL-backed, atomic upsert, race-proven | `docs/security/21-*.md` |
| Proxy-header trust | **Still not live-verified** — `TRUST_PROXY_HEADERS` remains unset/false | `docs/security/21-*.md`, `docs/testing/LOGIN_RATE_LIMIT_PROXY_TEST.md` |
| Structured logging and redaction | Verified — no PII/secrets in log events across all passes | `docs/security/16-*.md`, reconfirmed each subsequent step |
| Security headers (X-Frame-Options, X-Content-Type-Options, Referrer-Policy, Permissions-Policy) | Verified in code + locally | `docs/security/26-*.md` |
| CSP | Deliberately absent, documented | `docs/security/14-*.md`, `docs/security/26-*.md` |
| HSTS | Deliberately absent at app layer; Railway edge unverified | `docs/security/14-*.md`, `docs/security/26-*.md` |
| Cache-Control | **Gap** — never explicitly set anywhere in the codebase | `docs/security/26-*.md` |
| File upload limits | Verified — 5MB/5,000-row caps enforced | `docs/security/25-*.md` |
| ZIP preflight | Verified — metadata-only bomb defense, fixed a real defect | `docs/security/25-*.md` |
| Database connection parameters | Verified — no custom pool/timeout params, Prisma defaults observed empirically (pool size 9 = `cpu*2+1`) | `docs/security/24-*.md` |
| Transaction behavior | Verified against real PostgreSQL rollback (two independent proofs: chaos scenario B, file-security trigger-based test) | `docs/security/24-*.md`, `docs/security/25-*.md` |
| Backup/restore tooling | Verified locally; live Railway rehearsal deferred | `docs/testing/BACKUP_RESTORE_REHEARSAL.md` |
| Test-database guards | Verified — 6 dedicated guarded databases (test/e2e/perf/chaos/filetest/restore), zero production fallback in any of them, reconfirmed this pass via a full `npm ci` + preflight cycle | All prior steps |
| Production-only validation gaps | Consolidated in `docs/security/28-final-pilot-acceptance.md`'s residual-risk register | This pass |

## Changes made this pass

**None to application code or dependencies.** No advisory reached
`FIX NOW`, no unused dependency was found, and no license issue rises
to a code-level blocker (all are flagged for legal review, which is a
non-code action). Per the task's explicit instruction not to perform
broad "update everything" work and not to upgrade merely to obtain a
clean audit, `react`/`react-dom` (one patch version behind),
`eslint`/`lucide-react` (in-range patch versions available but not yet
installed), and the `@prisma/client`/`prisma`/`typescript`/`zod`/
`@types/node` major-version-behind packages were all **deliberately left
unchanged** — none are advisory-driven, and bumping them would be
exactly the "clean audit for its own sake" anti-pattern this step
warns against. One non-code change was made: `.gitignore` gained a
`/dependency-review-output/` entry (the same established pattern as
`/chaos-output/`, `/file-security-output/`, `/benchmark-output/`) so
this pass's raw machine-readable outputs (full license inventory, audit
JSON dumps) never get committed — this document is the committed
summary instead.

## Remaining risks

1. **Two unreachable-but-present moderate advisories** (`postcss`
   nested in `next`, `uuid` nested in `exceljs`) remain in the
   dependency tree with no non-major upstream fix available. Both are
   confirmed unreachable by this application's actual code paths (build-
   time-only CSS processing; a UUID function signature never invoked).
   **Accepted for pilot** — re-check on each `next`/`exceljs` upgrade,
   since a future release of either could change reachability.
2. **`@prisma/client`/`prisma` major version 7 exists** but was not
   adopted this pass (no advisory reason, real migration effort, out of
   this step's scope). Track for a dedicated future upgrade pass with
   its own compatibility validation.
3. **Two production-distributed packages have no declared license
   metadata** (`buffers`, `png-js`) — flagged for legal review, not
   resolved.
4. **LGPL-licensed native binaries bundled via `next`'s optional
   `sharp` dependency** — flagged for legal review as the only
   copyleft-family license present in the production dependency tree.
5. **`TRUST_PROXY_HEADERS` and `Cache-Control`** remain open from
   earlier steps (see the consolidation table above) — carried into
   `docs/security/28-final-pilot-acceptance.md`'s residual-risk
   register rather than restated as new findings here.
