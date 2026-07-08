# Injection & Untrusted Input Sweep

Date: 2026-07-08 (findings), fixes applied same branch (`deploy/postgresql-demo`).

Every point where external data (user input, HTTP params, headers, files,
third-party responses, environment values) enters the system was traced to
its sink (queries, shell/exec, file paths, templates, HTML output,
redirects, deserializers, eval-like constructs). Confirmed absent
codebase-wide: no `$queryRaw`/`$executeRaw`, no `dangerouslySetInnerHTML`,
no `eval`/`new Function`, no `child_process`, no dynamic `orderBy`/field-name
construction from user input, no middleware. Every Prisma call in the app is
parametrized by the ORM — SQL injection is not reachable anywhere found.

## Findings

### 🔴 HIGH — Stored XSS via `Pharmacy.mapUrl` — **FIXED**

**Entry point:** `mapUrl` field on the eczane (pharmacy) create/edit form
(`src/app/(dashboard)/eczaneler/actions.ts`, validated by
`src/lib/validations/pharmacy.ts`).

**Path:** admin/staff form → `pharmacySchema.mapUrl` → stored in
`Pharmacy.mapUrl` → rendered as `<a href={...}>` on the **unauthenticated
public** `/vatandas` page (`src/app/vatandas/page.tsx`, `routeUrl()`) and in
`src/components/visuals/duty-map.tsx`.

**Root cause:** zod's `.url()` validates syntax only, not scheme —
`javascript:`, `data:`, and `vbscript:` all pass it. Any STAFF/ADMIN account
could plant a script-executing link that fires for anonymous citizens
clicking "Yol Tarifi Al".

**Fix applied:**
- Added a reusable helper, `src/lib/validations/safe-url.ts`
  (`isSafeHttpUrl` / `safeHttpUrlSchema`), which parses the value with the
  `URL` constructor and only accepts `http:`/`https:` protocols.
- `pharmacySchema.mapUrl` now uses `z.union([z.literal(""), safeHttpUrlSchema()])`
  — empty string still allowed, everything else must be a genuine http/https URL.
- Both `createPharmacyAction` and `updatePharmacyAction` share this one
  schema, so both entry points are covered by a single fix.
- The Google Maps fallback link generator (`routeUrl()` in
  `src/app/vatandas/page.tsx`, used when `mapUrl` is empty) is unaffected —
  it always builds an `https://www.google.com/maps/search/...` URL itself.
- Tests: `src/lib/validations/safe-url.test.ts` (12 cases: accepts
  http/https/empty, rejects javascript:/data:/vbscript:/malformed strings,
  plus a `pharmacySchema` integration check).

**Status: fixed.**

---

### 🔴 HIGH — Vulnerable `xlsx@0.18.5` in the Excel upload/parse path — **FIXED (dependency replaced)**

**Entry point:** historical-duty Excel upload
(`src/app/(dashboard)/gecmis-nobetler/actions.ts` →
`parseHistoricalExcel()` in `src/lib/historical/parse-excel.ts`), the
schedule Excel export (`src/lib/scheduling/build-schedule-excel.ts`), and
the historical-duty template download
(`src/app/(dashboard)/gecmis-nobetler/sablon/route.ts`).

**Root cause:** `xlsx@0.18.5` had two unpatched-on-npm high-severity
advisories, confirmed via `npm audit`:
- `GHSA-4r6h-8v6p-xvw6` — Prototype Pollution (CVSS 7.8), fixed `<0.19.3`
- `GHSA-5pgg-2g8v-p4x9` — ReDoS (CVSS 7.5), fixed `<0.20.2`

Both trigger directly on `XLSX.read()`/`sheet_to_json()` of
attacker-controlled file content — exactly what the historical import
upload does. SheetJS moved the patched builds off the npm registry after
0.18.5, so `npm audit fix` could not resolve this without a library change.

**Fix applied — `xlsx` fully replaced with `exceljs@4.4.0`:**
- `src/lib/historical/parse-excel.ts` — rewritten to use
  `ExcelJS.Workbook#xlsx.load()` and manual row/cell iteration. Same
  behavior preserved: same header aliasing, same `MAX_IMPORT_ROWS` (5000)
  cap, same required-column check, same `dd.mm.yyyy` date-cell formatting.
  Now `async` (was previously synchronous) — the one caller
  (`historicalImportAction`) was updated to `await` it.
- `src/lib/scheduling/build-schedule-excel.ts` — rewritten to use
  `ExcelJS.Workbook#addWorksheet()`/`addRow()`/`xlsx.writeBuffer()`. Now
  `async` — the export route (`.../cizelgeler/[id]/export/excel/route.ts`)
  was updated to `await` it.
- `src/app/(dashboard)/gecmis-nobetler/sablon/route.ts` (template
  download) — same exceljs rewrite.
- `xlsx` dependency removed from `package.json` entirely; no remaining
  import anywhere in `src/`.
- Behavior preserved: `.xlsx` output format, column widths, Turkish header
  aliases, sample-row generation from live pharmacy data, and the
  5&nbsp;MB / 5000-row upload caps are all unchanged.
- Tests: `src/lib/historical/parse-excel.test.ts` (7 cases — aliased
  headers, real `Date` cell formatting, case/space-insensitive header
  matching, missing-required-column rejection, empty-file rejection,
  corrupt-buffer rejection, and an explicit check that a formula cell's
  *cached result* is read as inert text rather than being evaluated).

**Residual risk (documented per instructions):** `exceljs@4.4.0`
transitively depends on `uuid@8.3.2` via `fast-csv`, which has one
moderate advisory (`GHSA-w5hq-g745-h8pq`, CVSS 7.5 — missing buffer-bounds
check in `uuid` v3/v5/v6 **when a caller-supplied `buf` argument is
passed**). `npm audit`'s only offered fix is downgrading `exceljs` to
`3.4.0` (a semver-major regression), which is not a safe trade.

- This advisory is not reachable through our usage: `exceljs` never
  exposes a way for us (or file content) to pass a custom `buf` into
  `uuid`'s generation calls — it's used internally for style/defined-name
  IDs only.
- **Recommended production action:** periodically re-run `npm audit` /
  `npm outdated exceljs` and pick up a future `exceljs` release once one
  ships with a non-vulnerable `uuid` (or `fast-csv`) version, without
  requiring an application code change. No action is blocking for this
  deployment.

**Status: fixed (vulnerable direct dependency removed); one low-exposure
transitive advisory remains and is documented above, not exploitable via
this app's code paths.**

---

### 🟡 MEDIUM — Excel/CSV formula injection in exports — **FIXED**

**Entry points:** `Pharmacy.name`/`address`, and `DutyAssignment.note` (the
manual-edit "Değişiklik Nedeni" free-text field) — admin/staff-entered.

**Sinks:** cell values written via `ExcelJS` `addRow()` in
`src/lib/scheduling/build-schedule-excel.ts` (schedule export) and
`src/app/(dashboard)/gecmis-nobetler/sablon/route.ts` (template download,
uses live pharmacy data as sample rows).

**Root cause:** no leading-character check before writing string cells. A
pharmacy named e.g. `=HYPERLINK("http://evil","x")` would be written as a
literal formula-triggering string; Excel/LibreOffice may interpret it as a
formula when the exported file is later opened (CWE-1236).

**Fix applied:**
- Added `src/lib/excel-safety.ts` (`escapeExcelCell`): for any string cell
  value whose trimmed content starts with `=`, `+`, `-`, or `@`, prefixes
  the **original, untrimmed** string with a single quote (`'`) so
  spreadsheet applications render it as literal text instead of evaluating
  it as a formula. Non-string values (numbers, dates, null/undefined) pass
  through unchanged.
- Applied at write time only, in both Excel-generation call sites listed
  above — every row passed to `worksheet.addRow()` maps its cells through
  `escapeExcelCell()` first.
- **No stored/DB values are mutated** — the escaping happens only when
  building the export buffer, exactly as required.
- Tests: `src/lib/excel-safety.test.ts` (10 cases covering `=`, `+`, `-`,
  `@` triggers, leading-whitespace variants, and confirming normal text/
  numbers/dates/null/empty-string pass through unchanged).

**Status: fixed.**

---

## Verification performed

- `npm run typecheck` (via `npx tsc --noEmit`) — clean
- `npm run lint` — clean
- `npm test` — 102/102 passing (29 new tests added across the three fixes)
- `npm run build` — production build succeeds
- Manual browser verification: pharmacy create/edit rejects
  `javascript:`/`data:`/`vbscript:` `mapUrl` values with a Turkish
  validation error; `/vatandas` still renders and "Yol Tarifi Al" links
  still work for legitimate `http(s)` URLs and the Google-Maps fallback;
  historical-duty Excel template download, import preview, and final
  import all still work; schedule Excel and PDF export still download
  correctly.

## Not covered by this pass

The other sweep categories from the original security review (auth/session,
authorization/IDOR, business-logic abuse, etc.) were reviewed narratively in
the original sweep and found clean, but a dedicated fix pass for those
categories was out of scope here — this document covers only the
injection/untrusted-input findings and their fixes.
