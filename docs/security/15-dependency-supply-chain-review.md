# Dependency & Supply Chain Review

Date: 2026-07-09 (audit + fixes), same branch (`deploy/postgresql-demo`).

## Scope

Audited `package.json`/`package-lock.json` for unused dependencies,
version-conflicting duplicates in the tree, install-time script
execution, typosquat-suspicious names, and which dependencies sit on
security-critical paths (auth, parsing of untrusted input, the DB/ORM
layer) and therefore deserve exact version pinning. This document
covers the audit and the two narrow hardening actions from it — no
package version was upgraded, no library was replaced, and no
application behavior changed.

## Finding table

| # | Finding | Status |
|---|---|---|
| 1 | All 15 `dependencies` + 13 `devDependencies` are actually used (including config-only usage) | Clean |
| 2 | No typosquat-suspicious direct package name found | Clean |
| 3 | Install-time scripts limited to expected Prisma codegen hooks among direct dependencies | Clean |
| 4 | `exceljs`/`pdfkit`/`zod` (untrusted-input/validation paths) were not exact-pinned | **Fixed** |
| 5 | `docs/DEPLOYMENT.md` used `npm install` (not `npm ci`) in its build/deploy sequences | **Fixed** |
| 6 | 24 transitive packages resolve to multiple versions in the tree | Documented, non-actionable |
| 7 | Six packages need a live CVE/advisory check this repo cannot perform | NEEDS-CONTEXT (listed below) |
| 8 | Railway's actual dashboard-configured install command | Not inspectable from repo |
| 9 | Node built-in `crypto` used for password hashing/session tokens — no third-party auth dependency | Clean |

---

## 1. All direct dependencies are used — Clean

Every one of the 15 `dependencies` and 13 `devDependencies` in
`package.json` has confirmed real usage — either a direct import
somewhere under `src/`/`prisma/`/`scripts/`, or legitimate
config-only/CSS-import usage (`tw-animate-css` via `@import` in
`src/app/globals.css`; `@tailwindcss/postcss` via `postcss.config.mjs`;
`@types/*` packages as ambient typings). No dead/unused direct
dependency was found. No removal was made or is recommended.

## 2. No typosquat-suspicious names — Clean

Every direct dependency's name and `repository`/`homepage` metadata
under `node_modules/<pkg>/package.json` was checked against the
well-known canonical project it claims to be (`exceljs` →
`github.com/exceljs/exceljs`, `pdfkit` → `github.com/foliojs/pdfkit`,
`zod` → `github.com/colinhacks/zod`, all `@radix-ui/*` and `@prisma/*`
scoped packages, etc.). None resemble a typosquat of a more popular
package.

## 3. Install-time script execution — Clean

Only `@prisma/client` and `prisma` (both direct dependencies) run
install-time scripts (`postinstall`/`preinstall`), and both are
Prisma's own standard, expected engine-fetch/codegen hooks — not
unusual for this stack. Transitively, `esbuild`, `sharp`, and
`unrs-resolver` also run install scripts, all well-known
native-binary-fetch patterns common to a Next.js/Vitest/ESLint
toolchain. No unfamiliar or unexpected package runs an install script.

---

## Fixed findings

### 4. Exact-pin security-relevant direct dependencies — **Fixed**

**Before:** `exceljs` (`^4.4.0`), `pdfkit` (`^0.19.1`), and `zod`
(`^3.25.76`) were all range-pinned with `^`, while `@prisma/client`/
`prisma` were already exact-pinned (`6.19.3`). These three sit on the
paths with the most direct exposure to attacker-influenced bytes:
`exceljs` parses **untrusted, user-uploaded** historical-duty Excel
files (`src/lib/historical/parse-excel.ts`) in addition to generating
Excel exports; `pdfkit` generates PDF exports; `zod` validates
virtually all untrusted input reaching every server action. A `^`
range on any of these means a future `npm install`/lockfile
regeneration could silently pull in a newer minor/patch without an
explicit, reviewed `package.json` change.

**Fix:** `package.json` now pins exact versions:
```diff
- "exceljs": "^4.4.0",
+ "exceljs": "4.4.0",
- "pdfkit": "^0.19.1",
+ "pdfkit": "0.19.1",
- "zod": "^3.25.76"
+ "zod": "3.25.76"
```

**No installed version changed.** Before making this change, the
resolved versions already installed in `package-lock.json` were
confirmed to be exactly `exceljs@4.4.0`, `pdfkit@0.19.1`,
`zod@3.25.76` — identical to the new exact pins. This is a
`package.json`-only tightening of the *declared* range, not an upgrade
of the *installed* code.

**Lockfile regenerated and verified deterministic:** ran `npm install
--package-lock-only`, then diffed the resulting `package-lock.json`
against the pre-change version programmatically (comparing every
package key and its resolved `version` field). Result: **zero existing
package's resolved version changed, zero packages were removed.** The
only diff was 6 new nested metadata entries under
`node_modules/@tailwindcss/oxide-wasm32-wasi/node_modules/*` — an
**optional, not-installed** platform-specific native binding for
Tailwind's Oxide engine (`wasm32-wasi` variant, irrelevant on this
Linux x64 environment; confirmed `node_modules/@tailwindcss/oxide-wasm32-wasi`
does not exist on disk). This is npm filling in complete dependency-tree
metadata for an optional peer during lockfile regeneration, not an
upgrade of anything actually resolved or installed — no unrelated
transitive dependency's *version* changed. `npm ci` was then run
against this regenerated lockfile and completed successfully, confirming
the lockfile is internally consistent and installs deterministically.

### 5. `npm ci` in deployment/build documentation — **Fixed**

**Before:** `docs/DEPLOYMENT.md`'s "Projeyi Derleme (Build)" section
(§6) and its end-to-end hosted-demo command sequence both used `npm
install` ahead of `npm run build`. `npm install` can silently update
`package.json`-range-permitted dependencies and rewrite
`package-lock.json` if the lockfile and `package.json` have drifted —
not appropriate for a reproducible production/deploy build.

**Fix:** both occurrences now use `npm ci`, which installs exactly what
`package-lock.json` specifies and fails outright if the lockfile and
`package.json` are out of sync, rather than silently reconciling them.
A short note was added explaining why. `README.md`'s `npm install` in
its **local development** "Kurulum" section was deliberately left
unchanged — that's an iterative local setup step (where adding new
dependencies during development is expected), not a
deployment/build-reproducibility concern.

**`package-lock.json` is committed** — confirmed via `git ls-files |
grep package-lock` (tracked, not gitignored).

**Railway's actual install command is not repo-controlled** — there is
no `railway.json`, `railway.toml`, `Dockerfile`, or `nixpacks.toml`
anywhere in this repository (confirmed via a repo-wide search), so
whatever install command Railway's build system actually runs (its
default Nixpacks/Node builder behavior, or any dashboard-configured
override) lives entirely in Railway's dashboard and **cannot be
inspected or changed from this codebase.** This is the one part of
"deterministic installation behavior" this repo cannot fully control —
documented here rather than guessed at.

---

## Documented-only items (no code change)

### 6. Transitive duplicate versions in the tree

24 transitive (non-direct) packages resolve to more than one version
across the dependency tree (e.g. `debug`, `minimatch`,
`brace-expansion`, `postcss`, `semver`, `@types/node`). This is normal
npm behavior — different direct dependencies' own dependency ranges
pull in different transitive versions — and none of them are direct
dependencies conflicting with each other. The one cluster worth naming
because it sits on the untrusted-Excel-parsing path is `exceljs`'s own
zip/compression dependency chain (`pako`, `archiver-utils`,
`readable-stream`), each appearing at two versions; this is internal to
`exceljs`'s own transitive tree, not something this project's
`package.json` can directly resolve without `exceljs` itself changing
its dependencies upstream. **Not actionable from this repo** — flagged
for awareness only, no removal or override was made (per the explicit
instruction not to touch informational/transitive duplicates).

### 9. Node built-in `crypto` for auth — Clean (restated for completeness)

`src/lib/auth/password.ts` and `src/lib/auth/session.ts` use only
Node's built-in `node:crypto` module — `scrypt` (password hashing),
`randomBytes` (session token generation, both CSPRNG-backed), and
`timingSafeEqual` (constant-time comparison). **There is no third-party
password-hashing or session/JWT-signing package anywhere in the
dependency tree.** This removes the single highest-stakes dependency
category (auth/crypto) from this project's version-tracking and
patching burden entirely — a deliberate design choice, not an
oversight, and a positive finding for this audit.

## Packages requiring live advisory/CVE verification (NEEDS-CONTEXT)

This repo has no live CVE feed access. The following are marked
NEEDS-CONTEXT — this is **not** a claim that any of them is vulnerable
or safe, only that they sit on a security-relevant path and should be
checked against a real vulnerability database (e.g. `npm audit`,
GitHub Advisory Database, OSV) before/alongside any future version
decision:

- NEEDS-CONTEXT: `exceljs@4.4.0` — parses untrusted uploaded Excel
  files and generates exports
- NEEDS-CONTEXT: `pdfkit@0.19.1` — generates PDF exports; also a
  long-lived pre-1.0 release, worth checking upstream maintenance
  activity alongside any CVE check
- NEEDS-CONTEXT: `zod@3.25.76` — validates virtually all untrusted
  input reaching server actions
- NEEDS-CONTEXT: `@prisma/client@6.19.3` — database/ORM runtime layer
- NEEDS-CONTEXT: `prisma@6.19.3` — database/ORM CLI/migration tooling
- NEEDS-CONTEXT: `tw-animate-css@1.4.0` — smaller/newer package than
  the rest of the stack; worth a maintenance-activity check alongside
  any advisory check

## Not inspectable from this repo

- **Railway's actual dashboard-configured build/install command** — no
  `railway.json`/`railway.toml`/`Dockerfile`/`nixpacks.toml` exists in
  this repository, so whatever Railway's builder actually runs for
  dependency installation is configured entirely outside the codebase
  and cannot be verified or changed from here.
- Live CVE/security-advisory status for every NEEDS-CONTEXT package
  above — this repo/session has no live advisory feed access.

## Verification performed

- `npm install --package-lock-only` — regenerated the lockfile against
  the newly exact-pinned `package.json`; programmatically diffed
  against the prior lockfile: **zero existing package version changed,
  zero packages removed**, only 6 new metadata entries for an optional,
  not-installed platform variant (`@tailwindcss/oxide-wasm32-wasi`)
- `npm ci` — completed successfully against the regenerated lockfile
  (560 packages installed, no errors)
- Confirmed post-install: `exceljs` resolves to `4.4.0`, `pdfkit` to
  `0.19.1`, `zod` to `3.25.76` — identical to their pre-change resolved
  versions
- `git diff package.json` — confirmed the only changes are the three
  intended range→exact pins; no other direct dependency was touched
- `npx tsc --noEmit` — clean
- `npm run lint` — clean
- `npm test` — 217/217 passing (unchanged from before this pass — no
  test needed to change since no runtime behavior changed)
- `npm run build` — production build succeeds against a real local
  PostgreSQL instance, all routes registered
- `npx prisma migrate status` — "Database schema is up to date!";
  `git status` on `prisma/` shows no changes — **no schema or migration
  change was made or is required**, confirming this pass was
  entirely `package.json`/`package-lock.json`/documentation-scoped
