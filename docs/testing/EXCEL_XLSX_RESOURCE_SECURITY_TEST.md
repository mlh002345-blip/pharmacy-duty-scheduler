# Excel/XLSX Import-Export Resource & Security Test

Step 7 of the pre-pilot infrastructure and security test plan. Proves
that Excel/XLSX import and export paths safely handle large files,
malformed archives, ZIP-bomb-shaped compression, excessive rows/columns/
cells, formulas, dangerous cell values, duplicate rows, invalid dates,
concurrent operations, and interrupted processing — against a real local
PostgreSQL instance, never mocked, and without weakening any existing
validation.

## Supported import/export flows

- **Historical duty import** (`/gecmis-nobetler`,
  `historicalImportAction` in
  `src/app/(dashboard)/gecmis-nobetler/actions.ts`) — two-step
  preview-then-import flow using `parseHistoricalExcel()`
  (`src/lib/historical/parse-excel.ts`) and `exceljs@4.4.0`.
- **Duty schedule Excel export**
  (`/cizelgeler/[id]/export/excel`, `buildDutyScheduleExcel()` in
  `src/lib/scheduling/build-schedule-excel.ts`, fed by
  `loadDutyScheduleForExport()`).
- No standalone pharmacy-import, duty-balance-export, or audit-log-export
  Excel path exists in the current codebase (verified by search — only
  the two flows above touch `exceljs`). The PDF export route for the same
  dataset (`/cizelgeler/[id]/export/pdf`) does not use `exceljs`/ZIP
  parsing at all and is out of scope for this step.

## Prerequisites

- A local PostgreSQL 16 service reachable as role `app`.
- A dedicated file-security test database (e.g.
  `pharmacy_duty_scheduler_filetest`), distinct from every other guarded
  database (`DATABASE_URL`, `TEST_DATABASE_URL`, `E2E_DATABASE_URL`,
  `PERF_DATABASE_URL`, `CHAOS_DATABASE_URL`, `RESTORE_DATABASE_URL`).
- `FILE_TEST_DATABASE_URL` set to that database's connection string.

## Safe environment model

- `resolveFileTestDatabaseUrl()` (`tests/integration/helpers/test-db-guard.ts`)
  — the same shared guard core as every other dedicated-database command
  in this repo. Fails fast, before any migration, fixture generation,
  import, export, or cleanup, unless **all** hold:
  1. `FILE_TEST_DATABASE_URL` is set explicitly — no fallback to
     `DATABASE_URL`, `TEST_DATABASE_URL`, `E2E_DATABASE_URL`,
     `PERF_DATABASE_URL`, `CHAOS_DATABASE_URL`, or
     `RESTORE_DATABASE_URL`.
  2. It's a valid `postgresql://`/`postgres://` URL.
  3. It doesn't resolve to the same host+port+database as `DATABASE_URL`.
  4. Its database name contains `filetest`, `uploadtest`, `exceltest`,
     `xlsxtest`, `test`, `testing`, or `staging`.
  5. Neither its hostname nor database name contains `prod`,
     `production`, or `live` — always wins even alongside a valid
     marker.
- Every file-security Prisma client (`scripts/file-security/db.ts`,
  `tests/file-security/helpers/db.ts`) is constructed with
  `datasourceUrl: resolveFileTestDatabaseUrl()`'s output only — the
  suite never reads `DATABASE_URL` for a connection, and never touches
  Railway production.
- Cleanup (`npm run test:file:cleanup`) is manifest-based, mirroring
  `scripts/chaos/`'s and `scripts/perf/`'s design: every
  fixture-creating helper (`tests/file-security/helpers/fixtures.ts`)
  tags its rows with a `FILETEST-<runId>` marker and incrementally
  writes its parent ids (region/pharmacy/user/historical-batch) to a
  per-run manifest file under the gitignored `file-security-output/`
  directory. `validateManifestForCleanup()` refuses to run against a
  manifest missing the marker or tracking zero parent ids.
- Synthetic fixtures are generated in-memory by
  `scripts/file-security/fixtures.ts` — deterministic, never written to
  disk except transiently by the test harness's own gitignored output
  directory, and never committed to Git (some are deliberately
  large/zip-bomb-shaped).

## Commands

```bash
npm run test:file:preflight   # read-only guard + connectivity + migration-status check
npm run test:file             # run the full file-security suite
npm run test:file:cleanup     # manifest-based cleanup of this run's synthetic data
```

Normal `npm test`, `npm run test:integration`, `npm run test:e2e`,
`npm run test:perf`, and `npm run test:chaos` are unaffected —
`tests/file-security/**` is excluded from `vitest.config.ts`, and the
file-security suite has its own `vitest.file-security.config.ts` with
`fileParallelism: false` (benchmark tests measure process RSS/heap
deltas, which would be meaningless under concurrent sibling workers).

## Accepted file contract

- `.xlsx` only, ≤ 5 MB (pre-existing limit — not raised for this step).
- Must be a structurally valid ZIP archive containing an
  `xl/workbook.xml` entry.
- First worksheet only (`worksheets[0]`) — later sheets, including
  hidden/veryHidden sheets, are never read.
- Required headers: `Tarih`, `Eczane Adı` (position-independent,
  Turkish-alias and case/space-insensitive; duplicate header columns
  resolve to the last matching column, no exception thrown).
- ≤ `MAX_IMPORT_ROWS` = 5,000 data rows (pre-existing constant in
  `src/lib/historical/parse-excel.ts`, not the ZIP-preflight layer —
  enforced after the sheet is parsed into row objects).
- Cell values are always read as inert text (cached formula results,
  rich-text/hyperlink display text) — formulas are never evaluated,
  external links are never followed, no outbound request is ever
  triggered by a hyperlink cell.

## Enforced limits (ZIP-metadata preflight, `src/lib/zip-preflight.ts`)

Evidence-backed, applied **before** `exceljs` decompresses any archive
entry (see "ZIP bomb: baseline vulnerability" below for the measurement
that justified this layer):

| Limit | Default | Rationale |
|---|---|---|
| Max ZIP entry count | 100 | Real `.xlsx` files typically contain 10-20 internal parts; 100 gives generous headroom for multi-sheet/style-heavy workbooks without allowing thousands of tiny entries. |
| Max single-entry uncompressed size | 50 MB | Comfortably covers `MAX_IMPORT_ROWS` (5,000) worth of row XML with headroom for styles/shared-strings, while remaining far below the measured 430 MB RSS growth of the baseline bomb. |
| Max total uncompressed size | 100 MB | Twice the per-entry cap; bounds aggregate expansion even if several entries are each individually under the per-entry limit. |
| Max compression ratio (per entry) | 100:1 | Legitimate XLSX XML typically compresses 5-20:1; classic zip-bomb payloads (all-zero or highly repetitive data) compress at ratios in the thousands. 100:1 is well above legitimate use and well below bomb-shaped payloads. |

All four checks read only ZIP **central-directory metadata**
(`entry._data.uncompressedSize` / `.compressedSize`, populated by
`JSZip.loadAsync()` without decompressing entry content) — never the
decompressed bytes themselves. Structural checks applied at the same
layer, also metadata-only: ZIP signature validity, duplicate entry
names, unsafe entry paths (`../`, absolute paths), and presence of an
`xl/workbook.xml` entry.

`jszip@3.10.1` was promoted from an existing transitive dependency of
`exceljs` (which already vendors `JSZip.loadAsync()` internally for its
own parsing) to an **exact-pinned direct dependency**, so this
preflight code has an explicit, version-locked contract instead of
relying on an undeclared transitive package. No other new dependency
was added; a hand-rolled ZIP parser was explicitly avoided per the
task's constraints.

## Malicious/invalid fixture results

All rejected safely, with a generic Turkish error message and no
sensitive detail leaked (see "Error responses and logging" below).
Full coverage in `tests/file-security/specs/01-malicious-fixtures.filesec.test.ts`
(18 tests) and `src/lib/zip-preflight.test.ts` (10 pure unit tests):

| Fixture | Outcome | Layer |
|---|---|---|
| Empty file | Rejected (`not_a_zip`) | ZIP preflight |
| Non-XLSX file renamed `.xlsx` | Rejected (`not_a_zip` / `missing_workbook_entry`) | ZIP preflight |
| Truncated ZIP | Rejected (`not_a_zip`) | ZIP preflight |
| Corrupt central directory | Rejected (`not_a_zip`) | ZIP preflight |
| CFB/OLE-style stand-in for a password-protected workbook | Rejected (`not_a_zip`) | ZIP preflight |
| ZIP with `xl/workbook.xml` but no real worksheet part | Passes ZIP preflight (structurally a real ZIP); rejected by `exceljs`'s own structural parse | Workbook parse |
| Excessive sheet count (150) | Rejected (`too_many_entries`) | ZIP preflight |
| High-compression-ratio single entry (200 MB payload) | Rejected (`compression_ratio_too_high`) in < 1s, < 50 MB RSS growth | ZIP preflight |
| Missing required headers | Rejected (`HistoricalExcelParseError`) | Workbook parse |
| Reordered headers | Accepted (alias-based, position-independent mapping) | Workbook parse |
| Duplicate header columns | Accepted, no crash (last matching column wins) | Workbook parse |
| Formula cells | Accepted — cached result read as text, never evaluated | Workbook parse |
| Formula-trigger characters (`=`,`+`,`-`,`@`) in cell text | Accepted — pass through as inert text on import | Workbook parse |
| Hyperlink cell | Accepted — visible text only, no outbound request | Workbook parse |
| Invalid/impossible dates | Text extracted as-is (empty/unparsed downstream, no exception) | Workbook parse |
| Turkish characters | Accepted, round-trips correctly | Workbook parse |
| Duplicate logical rows | Accepted at parse layer (dedup is a downstream analysis concern) | Workbook parse |
| Hidden/veryHidden second sheet with data | Rejected — only `worksheets[0]` is ever read | Workbook parse |

## ZIP bomb behavior

**Baseline vulnerability (pre-fix, evidence):** a 200 KB crafted archive
containing one 200 MB all-zero entry, loaded via `exceljs`'s
`workbook.xlsx.load(buffer)` (which internally calls
`JSZip.loadAsync(buffer)` then decompresses every entry while parsing),
caused ~430 MB RSS growth in ~1.5s with no error — well within the
pre-existing 5 MB upload cap, i.e. a small uploaded file could still
force ~430 MB of server memory allocation.

**Post-fix:** the same archive is now rejected by
`preflightZipArchive()` before `exceljs` ever sees it — in ~3ms, with
~0 MB RSS growth, using only ZIP central-directory metadata (proven by
direct empirical measurement: `JSZip.loadAsync()` alone, without
calling `.async()` on an entry, does not decompress entry content).

## Formula-injection behavior

**Import:** formula cells are never evaluated — `parseHistoricalExcel()`
reads only the cached `result` for formula cells, or plain/rich text for
static cells; a cell literally starting with `=`, `+`, `-`, or `@` is
imported as inert text.

**Export:** `escapeExcelCell()` (`src/lib/excel-safety.ts`, pre-existing
from an earlier pre-pilot pass) prefixes any string cell whose trimmed
content starts with `=`, `+`, `-`, or `@` with a literal `'` character.
Proven end-to-end in
`tests/file-security/specs/02-formula-injection-export.filesec.test.ts`
(6 tests, one per required payload: `=HYPERLINK(...)`,
`=WEBSERVICE(...)`, `=cmd|' /C calc'!A0`, `+SUM(...)`, `-1+2`,
`@SUM(...)`) using real DB-backed pharmacy names through the real export
pipeline, with a genuine ExcelJS write→read round-trip: the re-read
cell's `type` is never `ExcelJS.ValueType.Formula`, and its string value
literally starts with `'`.

## Transaction rollback evidence

`historicalImportAction`'s commit path (`prisma.$transaction(async (tx)
=> {...})`) has no injectable test seam — unlike Step 6's chaos-tested
`generateAndSaveDutySchedule`. Prisma's interactive transactions give the
callback's `tx` object entirely fresh, independently-constructed
delegate instances per call (`createMany` etc. are own-properties of
each delegate, not shared via any prototype — verified directly via
`Object.getOwnPropertyNames()`), so no monkey-patching approach can
intercept a real transaction's internal writes from outside.

Instead,
`tests/file-security/specs/03-transaction-rollback.filesec.test.ts`
forces a **real PostgreSQL-level failure** with a `BEFORE INSERT`
trigger on the `AuditLog` table, scoped to fire only for that one test's
freshly-created admin user id. `writeAuditLog(tx, ...)` is the last
statement `historicalImportAction` runs inside its transaction, strictly
after `historicalDutyRecord.createMany` has already executed earlier in
the same still-open transaction — so the trigger fires exactly at the
"some rows have been processed, but not yet committed" moment, and the
resulting `ROLLBACK` is genuine Postgres behavior.

Result: after the forced failure, `HistoricalDutyImportBatch`,
`HistoricalDutyRecord`, and `AuditLog` all show **zero** rows for that
test's admin/pharmacies — proving no orphan batch, no partial record
set, and no misleading success audit entry survives a mid-transaction
failure. A subsequent normal import (same test file, same database)
succeeds cleanly, and retrying the exact same content after a genuinely
failed import does not create duplicate records — the DB-level unique
`fingerprint` constraint on `HistoricalDutyImportBatch` rejects it.

## Large-file benchmark numbers

Measured via `parseHistoricalExcel()` (the layer every real upload
passes through regardless of row count), process RSS before/after each
parse, `global.gc()` forced where available:

| Rows | File size | Parse duration | RSS delta | Outcome |
|---|---|---|---|---|
| 1,000 | 33.8 KB | 93.7 ms | +7.8 MB | Accepted |
| 5,000 (= `MAX_IMPORT_ROWS`) | 148.2 KB | 137.5-176.0 ms | -6.7 to +14.5 MB | Accepted |
| 5,001 (one over the limit) | 148.2 KB | 132.4 ms | +2.1 MB | Rejected (row-count limit) |
| 10,000 | 290.3 KB | 247.6 ms | +31.2 MB | Rejected (row-count limit) |
| 50,000 | 1.47 MB | 1,307.7 ms | +181.7 MB | Rejected (row-count limit) |

All well under the task's own suggested investigation thresholds
(>250 MB growth, >30s duration). The row-count check happens after the
sheet is fully parsed into row objects (inherent to correctly reading
an XLSX — row count can't be known without reading rows), so an
over-limit file is not rejected "for free," but its cost scales linearly
with the (still 5 MB-capped) file size, unlike a ZIP-bomb's exponential
expansion — the 50,000-row case above is the practical worst case at the
current 5 MB upload ceiling. The ZIP-metadata preflight layer separately
confirms a 50,000-row workbook's ZIP *shape* is legitimate (not
bomb-shaped) in < 1s, before the parse-layer cost is even incurred.

## Concurrent-operation results

`tests/file-security/specs/05-concurrency.filesec.test.ts` (4 tests):

- **Two simultaneous valid imports** (different regions/pharmacies):
  both commit, each with exactly its own batch/records — no
  cross-request mixing.
- **Five simultaneous valid exports** (different schedules): each
  produced file contains only its own schedule's pharmacy name, never
  another concurrent export's.
- **Valid import concurrent with a ZIP-bomb upload**: the valid import
  commits normally; the bomb is rejected via `ZipPreflightError`; total
  RSS growth across both concurrent operations stayed under 120 MB
  (proving the bomb's 200 MB payload was never decompressed even under
  concurrent load).
- **Two imports of identical content, raced via `Promise.allSettled`**:
  exactly one commits; the DB-level unique fingerprint constraint
  prevents both from succeeding even under a real race, leaving exactly
  one batch.

## Interrupted-processing results

`tests/file-security/specs/06-interrupted-processing.filesec.test.ts`
(3 tests) — since JS has no true mid-function preemption, each phase's
interruption is simulated by forcing a real exception at that exact
phase boundary (the same technique task item 7 sanctions for
transaction rollback):

- **During workbook parsing** (truncated ZIP): parse throws cleanly, no
  DB row is ever created, and a subsequent valid import in the same
  process succeeds normally.
- **During row validation/analysis** (before any DB write —
  `analyzeRows` reads holidays via the top-level, non-transactional
  Prisma client): forcing a real exception there leaves zero batches,
  and a subsequent request (after restoring the original method)
  succeeds normally.
- **During export generation** (DB-read phase of
  `loadDutyScheduleForExport`): forcing a real exception there throws
  cleanly with no partial file ever returned, and the very next export
  call succeeds and produces a complete, correct file.

All three prove: no partial success is ever reported, no stale DB state
remains, and the next request always succeeds — no leaked lock, temp
file, or corrupted shared mock state.

## Cleanup

`npm run test:file:cleanup` reads every manifest under
`file-security-output/`, refuses to act on any manifest missing its
`FILETEST-<runId>` marker or tracking zero parent ids, and deletes only
that run's tracked rows in FK-safe order: `AuditLog` →
`HistoricalDutyRecord` → `HistoricalDutyImportBatch` → `DutyRule` →
`Pharmacy` → `User` → `Region`. Running the full suite twice
consecutively against the same database produced 41/41 passing tests
both times, confirming manifests and cleanup do not leak state across
runs.

## Local vs. Railway limitations

- This suite requires a directly reachable local (or otherwise
  dedicated, non-production) PostgreSQL instance with a role able to run
  `CREATE TRIGGER`/`CREATE FUNCTION` (needed only by the transaction-
  rollback test, torn down in the same test via `DROP TRIGGER`/`DROP
  FUNCTION`). Railway's managed Postgres should work identically as long
  as `FILE_TEST_DATABASE_URL` points at a dedicated non-production
  database and the connecting role has those DDL permissions.
- Benchmarks measure process RSS from *this* process — Railway's
  container memory ceiling should still be checked independently in a
  staging deploy before raising any current limit, since actual
  container overhead (Node runtime, other in-flight requests) is not
  simulated here.
- The suite never uploads test files to Railway production, and never
  runs as part of any Railway deploy/build step — it is invoked
  explicitly via `npm run test:file` only.

## Admin/user guidance for rejected files

Every rejection surfaces a short, generic Turkish message (see
"Error responses and logging" in
`docs/security/25-excel-xlsx-resource-security-validation.md` for the
full mapping) — e.g. "Dosya geçerli bir ZIP/Excel arşivi değil.",
"Dosya izin verilenden fazla iç bileşen içeriyor.", "Dosyada N satır
var; tek seferde en fazla 5000 satır aktarılabilir. Lütfen dosyayı
bölerek yükleyin." A user hitting the row-count limit should split their
workbook into multiple files and import them sequentially; a user
hitting a structural/ZIP rejection should re-export the file fresh from
their source spreadsheet tool rather than re-uploading a possibly
corrupted copy.
