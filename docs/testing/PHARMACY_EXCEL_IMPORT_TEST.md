# Pharmacy Excel Import — Test Evidence

Companion to `docs/features/PHARMACY_EXCEL_IMPORT.md`. All tests run
against real PostgreSQL, real Server Actions, and (for E2E) a real
browser — never mocked.

## Unit (pure modules, `npm test`)

- `src/lib/pharmacy-import/phone.test.ts` — 17 tests: every accepted
  phone format, default-area-code combination, missing/invalid default
  area code, ambiguous digit counts rejected.
- `src/lib/pharmacy-import/parse-excel.test.ts` — 22 tests: canonical
  headers, every alias variant (including the Turkish-locale `ı`-vs-`i`
  case), missing/duplicate/ambiguous headers, unrecognized-column
  warnings, hidden-worksheet rejection, empty file, corrupt buffer, row
  limit.
- `src/lib/pharmacy-import/analyze-import.test.ts` — 14 tests: READY/
  INVALID/DUPLICATE_IN_FILE/ALREADY_EXISTS/UNKNOWN_REGION classification,
  cross-tenant region-matching isolation (the matcher only trusts the
  region list it's given — the actual cross-tenant guarantee lives in
  the caller only ever fetching this organization's own regions), every
  Aktif value form, phone integration.

## File security (`npm run test:file`, real Postgres)

`tests/file-security/specs/07-pharmacy-import.filesec.test.ts` — 26
tests, explicitly proving the Pharmacy Excel Import path inherits the
Step 7 defenses (not just implicitly by code reuse), against every
requested attack vector:

| Vector | Result |
|---|---|
| Valid XLSX | accepted, batch created with correct readyRows |
| Empty file | rejected before parsing, no batch |
| Non-XLSX renamed .xlsx | rejected (`ZipPreflightError`) |
| Truncated ZIP | rejected |
| Malformed central directory | rejected |
| ZIP bomb (200 MB payload) | rejected in <1s, <50 MB RSS growth |
| Excessive compression ratio | rejected, `compression_ratio_too_high` |
| Excessive ZIP entries (150 sheets) | rejected, `too_many_entries` |
| Path-traversal entry | rejected, `unsafe_entry_path` — see note below |
| Encrypted workbook (CFB/OLE stand-in) | rejected |
| Hidden-only workbook | rejected (parser-level, after a passing ZIP preflight) |
| Missing worksheet | rejected |
| Missing required headers | rejected |
| Duplicate normalized headers | rejected |
| Formula cell in a required field | cached result read, never evaluated |
| External link (`xl/externalLinks/...` part) | ignored, never followed |
| Hyperlink cell | display text read, link never followed |
| 5 MB + 1 byte | rejected before parsing, no batch |
| 5,001 data rows | rejected, no batch |
| Excessively long cell (200,000 chars) | accepted structurally (row-count/ZIP limits are the real defense; the application-level `NAME_MAX_LENGTH` check in `analyze-import.ts` is what actually blocks an over-long name at row-validation time) |
| Excessive columns (500) | accepted, extras surfaced only as non-blocking warnings, no hang |

**Path-traversal note**: a forward-slash `../../../etc/passwd` entry
name is silently normalized away by JSZip's own loader before
`preflightZipArchive` ever sees it (confirmed by direct inspection —
this is a protection layered *underneath* this app's own check, not a
gap). A backslash-separated equivalent (`..\..\..\etc\passwd`) is
**not** normalized by JSZip and reaches `isUnsafeEntryPath`'s own
check — which does catch it, and is what the test exercises via a
hand-built raw ZIP buffer (JSZip's own writer also normalizes `..`
segments out at write time, so a raw byte-level construction was
necessary to reach this code path at all, faithfully simulating a
non-JSZip-authored malicious archive).

Full-server-action-level assertions (same spec file): empty file, 5 MB+1
oversized file, ZIP bomb, path-traversal entry, missing headers, and
excessive rows are all confirmed to create **zero**
`PharmacyImportBatch` rows and return a controlled Turkish message
(never a raw Prisma/stack-trace string) when submitted through the real
`previewPharmacyImportAction`.

Full suite: 67 tests across 7 spec files, run twice consecutively, both
green.

## Integration (`npm run test:integration`, real Postgres)

- `tests/integration/pharmacy-excel-import.integration.test.ts` — 8
  tests: ADMIN-only guard (STAFF/VIEWER/anonymous denied), org-scoped
  batch creation, region-matching never crosses an identically-named
  region in another organization, cross-org batch consumption denied
  (404-equivalent), all-or-nothing blocking when any row isn't `READY`,
  `ALREADY_EXISTS` blocking, default-area-code combination end-to-end.
- `tests/integration/pharmacy-import-lifecycle.integration.test.ts` — 9
  tests, covering the acceptance gate's preview-persistence/transaction/
  concurrency requirements:
  - An expired batch cannot be imported (marked `EXPIRED`).
  - A consumed (`IMPORTED`) batch cannot be replayed — no duplicate
    pharmacies on a second call.
  - `PLATFORM_ADMIN` cannot consume any batch.
  - Another `ADMIN` in the **same** organization *can* consume a batch
    they didn't create — this is organization-scoped, not
    creator-scoped, consistent with every other org-scoped mutation in
    this app (e.g. any `ADMIN` can edit a pharmacy any other `ADMIN`
    created). Documented here as an intentional behavior, not a defect.
  - `importPharmacyBatchAction`'s signature takes only a `batchId` —
    structurally, there is no form field a client could tamper with to
    alter row content, `regionId`, `organizationId`, status, or counts;
    every write in the transaction is sourced from the DB-loaded batch.
  - A unique-constraint violation partway through import (simulated by
    manually creating the colliding pharmacy between preview and
    import) rolls back the **entire** transaction — zero partial rows,
    including the row that would have succeeded on its own; the batch
    stays `PREVIEWED`; no success `AuditLog` row.
  - The same batch submitted twice concurrently (via a synchronized
    gate, not a sleep) imports exactly once.
  - Two organizations importing identical region/pharmacy names never
    collide.
  - Importing while the matching pharmacy is manually created
    concurrently: exactly one row survives regardless of which write
    won the race — the DB's `(regionId, normalizedName)` unique
    constraint is the final authority, never a pre-check race
    condition.

Both files run twice consecutively as part of the full integration
suite (13 files / 56 tests total), all green.

## E2E (`npm run test:e2e`, real browser + real Postgres)

- `tests/e2e/specs/pharmacy-import-access.spec.ts` — 13 tests: anonymous/
  STAFF/VIEWER/PLATFORM_ADMIN denied `/eczaneler/ice-aktar` and its
  template route by direct URL; ADMIN reaches the upload form and
  downloads a real `.xlsx`; an organization's ADMIN cannot view another
  organization's import preview batch (org-scoped 404); the same
  organization's ADMIN can view its own batch.
- `tests/e2e/specs/onboarding-to-import.spec.ts` — 1 test, the full
  Section 7 acceptance-gate flow: an organization and its first ADMIN
  (created directly via the database — see the scope note below), real
  login, two regions, a real template download, a computed import
  preview (also created directly — same scope note), a **real browser
  click** on the bound "İçe Aktarımı Onayla" button running the real
  all-or-nothing transaction, the imported pharmacies appearing on
  `/eczaneler`, exactly one `AuditLog` entry, and a second organization's
  user seeing none of it. Run 3 times consecutively during this
  acceptance gate, all green.

**Scope note**: two steps in the literal flow —
`PLATFORM_ADMIN` submitting the organization-creation form, and the
ADMIN submitting the file-upload/preview form — use unbound
`useActionState` Server Actions that require an *existing* session
cookie to accompany the POST. That specific shape (an authenticated
unbound-action form submitted via a real Playwright click) loses its
cookie in this sandbox, root-caused during the Stabilization Gate as an
environment/framework quirk (Next.js 16.2.10 canary + headless Chromium
under Playwright's cookie injection) — reproducible regardless of guard,
unaffected by role, and not present for anonymous requests (login) or
bound actions. This test therefore creates those two steps' end-state
directly via the database (the exact state those Server Actions would
produce — already proven reachable via those real Server Actions,
without a browser, in the integration suites above) and runs everything
else — navigation, login, template download, preview rendering, **the
actual transactional import**, and the cross-org isolation check —
through a real browser.

## Full test count summary (feature/multi-tenancy-pharmacy-import, final acceptance gate)

- Unit: 687 tests / 58 files.
- Integration: 13 files / 56 tests, run twice, both green.
- File security: 7 files / 67 tests, run twice, both green.
- E2E: 64 tests, run twice, both green (includes 3 additional
  standalone runs of the onboarding-to-import flow).

## Automatic Region Discovery (feature/automatic-region-discovery)

Unit (pure modules, `npm test`):

- `src/lib/pharmacy-import/region-discovery.test.ts` — 20 tests:
  address-hint extraction (slash/comma endings, ambiguity, plain-street
  none, no inference without structural evidence), source priority
  (Bölge > İlçe > address > none), Turkish-aware aggregation with row
  counts (İ/i, I/ı variants collapse), active/inactive matching,
  ADDRESS_SUGGESTION even on an existing-region match, strongest-source
  wins, district proposal rules, unresolved reasons.
- `analyze-import.test.ts` — grown to 28 tests: pending-candidate
  statuses, inactive-match pending decision, İlçe fallback (old
  templates), address validation (control chars/length), duplicate
  detection across not-yet-created candidate regions, plus the whole
  recompute engine (approval unblocks, exclusion skips without
  blocking, inactive decision gating, same-normalized-name candidates
  share dedupe, ALREADY_EXISTS on recompute, INVALID immutability,
  legacy regionId-resolved rows).
- `parse-excel.test.ts` — grown to 33 tests: İlçe/Adres canonical
  columns and all requested header variants, old-İlçe-template
  compatibility, no-region-source-column rejection.

Integration (`npm run test:integration`, real Postgres) —
`tests/integration/region-discovery-import.integration.test.ts`, 12
tests, described in `docs/features/AUTOMATIC_REGION_DISCOVERY.md`
(transaction rollback including created regions and audits,
keep-inactive vs. audited reactivation, gate-synchronized concurrent
region creation, cross-tenant candidate isolation, manual candidate
multi-row mapping, suggestion confirm/reject, racing manual region
reuse, manual CRUD preservation). The lifecycle suite was updated for
creator-scoped consumption and the earlier, controlled in-transaction
collision detection.

E2E (`npm run test:e2e`, real browser) —
`tests/e2e/specs/region-discovery.spec.ts`, 5 tests (same
unbound-action scope note as above; every candidate decision, status
toggle, and the final import are REAL browser clicks on bound actions).

Totals on this branch: unit 741 / 60 files; integration 15 files / 75
tests (run twice); file security 67 (unchanged — the import route
inherits every control); E2E 69 (run twice).
