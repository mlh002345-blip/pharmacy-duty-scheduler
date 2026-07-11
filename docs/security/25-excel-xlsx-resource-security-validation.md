# Excel/XLSX Import-Export Resource & Security Validation

Date: 2026-07-11, branch `deploy/postgresql-demo`. Pre-pilot test plan,
Step 7.

## Scope

Validated that Excel/XLSX import and export paths safely handle large
files, malformed archives, compression bombs, excessive rows/columns/
cells, formulas, dangerous cell values, duplicate rows, invalid dates,
concurrent operations, and interrupted processing — against a real,
dedicated local PostgreSQL database, never mocked, and using only
synthetic data. Full architecture, safety model, and commands are in
`docs/testing/EXCEL_XLSX_RESOURCE_SECURITY_TEST.md`.

## Actual import/export inventory (inspected, not assumed)

- `exceljs@4.4.0` is the app's only XLSX library (already replaced from
  a vulnerable `xlsx@0.18.5` in an earlier pre-pilot pass — see
  `docs/security/01-injection-untrusted-input-sweep.md`).
- Two real flows use it: **historical duty import**
  (`historicalImportAction` →
  `parseHistoricalExcel()`) and **duty schedule Excel export**
  (`buildDutyScheduleExcel()` fed by `loadDutyScheduleForExport()`). No
  pharmacy-import, duty-balance-export, or audit-log-export Excel path
  exists in the current codebase.
- `parseHistoricalExcel()` buffers the entire uploaded file
  (`Buffer.from(await file.arrayBuffer())`) and loads it fully via
  `workbook.xlsx.load(buffer)` before any row-level processing — no
  streaming parse. Only `worksheets[0]` is ever read.
- Pre-existing upload cap: 5 MB (`file.size > 5 * 1024 * 1024` check in
  `historicalImportAction`, unchanged by this step).
- Pre-existing row cap: `MAX_IMPORT_ROWS = 5000`
  (`src/lib/historical/parse-excel.ts`), enforced after the sheet is
  fully parsed into row objects.
- No sheet-count, column-count, or cell-string-length limit existed
  anywhere before this step, at any layer.
- Formula cells: `parseHistoricalExcel()`'s `cellToString()` already
  read only the cached `result` for formula-typed cell values, never the
  formula source or a live-evaluated result — formulas were never
  executed on import even before this step.
- Export-side formula-injection defense (`escapeExcelCell()` in
  `src/lib/excel-safety.ts`) already existed from an earlier pre-pilot
  pass, with its own pre-existing unit tests
  (`src/lib/excel-safety.test.ts`).
- Import transaction boundary: `prisma.$transaction(async (tx) =>
  {...})` wrapping `historicalDutyImportBatch.create` →
  `historicalDutyRecord.createMany` → `writeAuditLog(tx, ...)`, already
  present. `HistoricalDutyImportBatch.fingerprint` is a DB-level
  `@unique` constraint, already present, providing real duplicate-import
  rejection independent of any app-level pre-check.

## Vulnerability found: ZIP-bomb-style resource exhaustion (baseline evidence)

**Before this step**, no ZIP-metadata validation existed anywhere in the
import path — `parseHistoricalExcel()` called `workbook.xlsx.load(buffer)`
directly, which internally invokes `JSZip.loadAsync(buffer)` then
decompresses **every** archive entry's content while parsing.

**Measured baseline defect:** a 200 KB crafted `.xlsx`-shaped ZIP archive
containing a single entry that decompresses to 200 MB of all-zero bytes
(`compression: "DEFLATE"`, `level: 9`) was passed through
`workbook.xlsx.load()`. Result: **~430 MB RSS growth in ~1.5s, no error
thrown** — and the 200 KB input file was well within the existing 5 MB
upload cap, meaning an attacker (or an accidentally-corrupted real file)
could force ~430 MB of server memory allocation per request with no
rejection.

**Root cause:** `exceljs`'s `workbook.xlsx.load()` has no size/ratio
awareness — it decompresses and parses every entry unconditionally.

**Fix:** `src/lib/zip-preflight.ts`, a new `preflightZipArchive()`
function called before `parseHistoricalExcel()` in
`historicalImportAction`. Uses `JSZip.loadAsync(buffer)` **directly**
(bypassing `exceljs`) to read only ZIP central-directory metadata
(`entry._data.uncompressedSize` / `.compressedSize`) — confirmed
empirically that this alone does not decompress entry content (same
200 MB-entry archive: 3ms load time, 0 MB RSS growth, metadata
immediately available). Rejects before any decompression if: entry
count > 100, any single entry's uncompressed size > 50 MB, total
uncompressed size > 100 MB, or any entry's compression ratio > 100:1
(see `docs/testing/EXCEL_XLSX_RESOURCE_SECURITY_TEST.md` for the full
rationale behind each threshold). Also rejects: invalid ZIP signature,
duplicate entry names, unsafe entry paths (`../`, absolute paths), and
missing `xl/workbook.xml` entry.

**Dependency change:** `jszip` was already an indirect/transitive
dependency of `exceljs` at version `3.10.1`. Promoted to an
**exact-pinned direct dependency** (`"jszip": "3.10.1"` in
`package.json`) so this preflight code has an explicit, version-locked
contract rather than relying on an undeclared transitive package. No
other new dependency was added, and no hand-rolled ZIP parser was
written.

**Before/after evidence** (same 200 MB-bomb fixture, measured in
`tests/file-security/specs/01-malicious-fixtures.filesec.test.ts`):

| | Before fix | After fix |
|---|---|---|
| Outcome | Silently succeeds, no error | Rejected (`ZipPreflightError`, `compression_ratio_too_high`) |
| Duration | ~1.5s | ~3ms (well under the test's 1s assertion) |
| RSS growth | ~430 MB | < 50 MB (test-asserted; typically ~0 MB) |

## ZIP bomb result

See above — fully mitigated by the ZIP-metadata preflight layer, applied
before any archive entry is decompressed. Verified against 8 distinct
malicious/malformed fixture categories (empty file, non-ZIP renamed
`.xlsx`, truncated ZIP, corrupt central directory, CFB/OLE
password-protected stand-in, missing-worksheet workbook, excessive sheet
count, high-compression-ratio entry) plus 10 additional pure unit tests
in `src/lib/zip-preflight.test.ts` covering entry-count, per-entry-size,
total-size, and compression-ratio limits with custom configurations.

## Formula-injection result

**Import:** confirmed (pre-existing behavior, now covered by a
regression test) that formula cells are never evaluated — only the
cached result is read. Cells containing raw `=`, `+`, `-`, `@`-prefixed
text (not stored as a formula type, just plain text starting with a
trigger character) pass through as inert text — proven via
`buildFormulaTriggerCharsWorkbook` in
`tests/file-security/specs/01-malicious-fixtures.filesec.test.ts`.

**Export:** confirmed (pre-existing `escapeExcelCell()`, now covered by
an end-to-end regression test using real DB data through the real export
pipeline rather than only the isolated unit test) that all 6 required
payloads (`=HYPERLINK(...)`, `=WEBSERVICE(...)`, `=cmd|' /C calc'!A0`,
`+SUM(...)`, `-1+2`, `@SUM(...)`) survive a genuine ExcelJS write→read
round-trip as inert, `'`-prefixed text — never as a live formula cell
(`cell.type !== ExcelJS.ValueType.Formula`). No defect found; no fix
needed here.

## Transaction consistency result

**No pre-existing defect found.** `historicalImportAction`'s
`prisma.$transaction(...)` boundary already correctly wraps all three
writes (batch create, record `createMany`, audit log). Verification
required a novel fault-injection technique since Prisma's interactive
transaction callback receives entirely fresh, unpatchable delegate
objects per call (confirmed via `Object.getOwnPropertyNames()`
inspection — `createMany` etc. are own-properties of each delegate
instance, not shared via any common prototype).

**Test technique:** a real PostgreSQL `BEFORE INSERT` trigger on
`AuditLog`, scoped to one test's admin user id, forces a genuine
Postgres-level exception after `historicalDutyRecord.createMany` has
already executed within the same still-open transaction (`writeAuditLog`
is the transaction's last statement). See
`tests/file-security/specs/03-transaction-rollback.filesec.test.ts`.

**Result:** after the forced failure, zero
`HistoricalDutyImportBatch` rows, zero `HistoricalDutyRecord` rows, and
zero `AuditLog` rows exist for that test's data — proving a genuine
PostgreSQL `ROLLBACK` correctly discarded rows that had already been
physically written earlier in the same transaction. No orphan batch, no
partial record set, no misleading success audit entry. Retrying the
exact same content after a genuinely failed import does not create
duplicates — enforced by the DB-level unique `fingerprint` constraint,
confirmed to still function correctly against real Postgres.

## Large-file memory/timing results

Measured via `parseHistoricalExcel()`, `tests/file-security/specs/04-large-file-benchmarks.filesec.test.ts`:

| Rows | File size | Parse duration | RSS delta | Outcome |
|---|---|---|---|---|
| 1,000 | 33.8 KB | 93.7 ms | +7.8 MB | Accepted |
| 5,000 (limit) | 148.2 KB | 137.5-176.0 ms | -6.7 to +14.5 MB | Accepted |
| 5,001 (over limit) | 148.2 KB | 132.4 ms | +2.1 MB | Rejected |
| 10,000 | 290.3 KB | 247.6 ms | +31.2 MB | Rejected |
| 50,000 | 1.47 MB | 1,307.7 ms | +181.7 MB | Rejected |

All well under the task's suggested investigation thresholds (>250 MB
growth, >30s processing). No defect found; no fix applied — existing
`MAX_IMPORT_ROWS` cap combined with the pre-existing 5 MB upload cap
already bounds worst-case parse cost to sub-2-second, sub-200 MB, even
for a maximally-sized row-count-rejected file. No automatic timeout
increase was made.

## Concurrency result

`tests/file-security/specs/05-concurrency.filesec.test.ts` (4 tests, all
passing): two simultaneous valid imports committed independently with no
cross-request data mixing; five simultaneous valid exports each produced
a file containing only its own schedule's data; a valid import running
concurrently with a ZIP-bomb upload succeeded/rejected correctly with
combined RSS growth under 120 MB; two imports racing identical content
via `Promise.allSettled` resulted in exactly one commit, enforced by the
real DB-level unique fingerprint constraint even under a genuine race.
No defect found.

## Interrupted-processing result

`tests/file-security/specs/06-interrupted-processing.filesec.test.ts`
(3 tests, all passing): forced real exceptions at the workbook-parsing,
row-validation, and export-generation-DB-read phase boundaries. In every
case: no partial success was ever reported, no stale DB row was left
behind, and the very next request in the same process succeeded
normally — no leaked lock, temp file, or corrupted shared state. No
defect found.

## Bugs found and fixes

1. **ZIP-bomb resource exhaustion** (production code defect) — fixed via
   `src/lib/zip-preflight.ts`'s metadata-only preflight, detailed above.
   This is the only production code change made in Step 7 beyond wiring
   the preflight call and two log statements into
   `historicalImportAction`.
2. **Test-harness cleanup bug, caught by running the suite's own
   cleanup script** (`scripts/file-security/cleanup.ts`): the
   formula-injection-export, concurrency, and interrupted-processing
   specs create real `DutySchedule`/`DutyAssignment` rows to exercise
   the export pipeline, but `cleanup.ts` never deleted them before
   deleting their referenced `Pharmacy`/`Region` rows — the first
   cleanup run after adding those specs failed with `P2003 Foreign key
   constraint violated on DutyAssignment_pharmacyId_fkey`, leaving 21
   accumulated test runs' worth of orphaned rows in the file-test
   database. Fixed by adding `dutyAssignment.deleteMany({ where: {
   pharmacyId: { in: pharmacyIds } } })` and `dutySchedule.deleteMany({
   where: { regionId: { in: regionIds } } })` before the existing
   `dutyRule`/`pharmacy` deletes. Verified: a subsequent cleanup run
   against the same (previously failing) database succeeded for all 21
   accumulated manifests, and two further consecutive full-suite runs
   followed by cleanup completed cleanly with zero errors. This bug was
   in test infrastructure only — no application code was affected, and
   no production data was ever at risk (the file-test database is never
   `DATABASE_URL`).

No other defects were found — the pre-existing row cap, upload-size cap,
formula-injection defenses (both import and export), transaction
boundary, and duplicate-fingerprint constraint all held under adversarial
and concurrent testing without modification.

## Error responses and logging

User-facing messages are short, generic, Turkish, and reveal no internal
detail (e.g. `"Dosya geçerli bir ZIP/Excel arşivi değil."`, `"Dosya izin
verilenden fazla iç bileşen içeriyor."`, `"Dosya sıkıştırma oranı
güvenlik sınırının üzerinde."`). Distinct `ZipPreflightError.reasonCode`
values distinguish structural rejections (`not_a_zip`, `duplicate_entry`,
`unsafe_entry_path`, `missing_workbook_entry` → logged as
`excel_upload_rejected`) from capacity violations (`too_many_entries`,
`entry_too_large`, `total_too_large`, `compression_ratio_too_high` →
logged as `excel_resource_limit_exceeded`), each carrying only
`requestId`, `reasonCode`, and `fileSize` — never uploaded content.
`excel_import_completed` (new) logs `requestId`, `userId`,
`acceptedRowCount`, `matchedCount` on success. Pre-existing
`historical_import_failed` and `schedule_excel_export_failed` events
continue to serve the `excel_import_failed`/`excel_export_failed` roles
and were inspected to confirm they log only counts/reason codes, never
row contents, names, phone numbers, formulas, session tokens, database
URLs, full local file paths, or raw binary/XML content. No per-row error
logging exists for any rejected file, avoiding log-flooding on a
large invalid upload.

## Test counts

- New pure unit tests: 10 (`src/lib/zip-preflight.test.ts`).
- New file-security integration suite
  (`npm run test:file`): 41 tests across 6 spec files
  (18 malicious-fixture, 6 formula-injection-export, 3
  transaction-rollback, 7 large-file-benchmark, 4 concurrency, 3
  interrupted-processing).
- Suite run twice consecutively against the same database: 41/41 passing
  both times, confirming manifest-based cleanup leaves no cross-run
  state.
- Full normal suite (`npm test`): 589 tests, unaffected.

## Migration/dependency status

No Prisma migration was needed — no schema change. One new exact-pinned
direct dependency: `jszip@3.10.1` (previously an undeclared transitive
dependency of `exceljs`), justified above.

## Pilot-readiness conclusion

The one real defect found (ZIP-bomb resource exhaustion via
`exceljs`'s unconditional decompression) is fixed with a minimal,
evidence-backed, dependency-light preflight layer, verified against 8
adversarial fixture categories plus 10 pure unit tests, and does not
change any existing validation behavior for legitimate files (all
pre-existing malicious/invalid-fixture and normal-import/export
behavior remains unchanged, confirmed by the full 589-test normal suite
staying green). Transaction consistency, formula-injection defenses
(both directions), concurrent-operation isolation, and
interrupted-processing recovery were all verified against real
PostgreSQL and found to already be correct, with no further code changes
required. Excel/XLSX import and export are considered safe for pilot
use at the current 5 MB / 5,000-row limits.
