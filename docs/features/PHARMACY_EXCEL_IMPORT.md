# Pharmacy Excel Import

Multi-Tenancy Chunk 3, branch `feature/multi-tenancy-pharmacy-import`
(commit `e755a79`). Generic, province-agnostic bulk pharmacy import for
every organization's own `ADMIN`.

## Workflow

```
Eczaneler → "Excel ile İçe Aktar" → Şablon indir → Dosya yükle
  → Ön izleme (server-persisted) → Doğrulama → Tek transaction ile içe aktar
```

- `/eczaneler/ice-aktar` — upload form (file + optional "Varsayılan Alan
  Kodu"), template download link.
- `/eczaneler/ice-aktar/sablon` — GET route, generates an XLSX with two
  sheets ("Eczaneler" with the canonical headers + one illustrative
  example row; "Açıklamalar" explaining every rule below) via
  `ExcelJS` + the existing `escapeExcelCell()` (`src/lib/excel-safety.ts`).
- `previewPharmacyImportAction` (`src/app/(dashboard)/eczaneler/ice-aktar/actions.ts`)
  parses, validates, and matches every row against **this organization's
  own** regions/pharmacies (never another org's), then persists the
  result to `PharmacyImportBatch`/`PharmacyImportRow` (never to
  `Pharmacy` rows, and never the workbook binary itself) — see "Why
  persisted, not round-tripped" below.
- `/eczaneler/ice-aktar/onizleme/[batchId]` — preview page, renders the
  persisted batch.
- `importPharmacyBatchAction(batchId)` — the only mutating step. One
  `prisma.$transaction` creates every `READY` row's `Pharmacy` row,
  flips the batch to `IMPORTED`, and writes one `AuditLog` entry.

## Access control

`ADMIN` only, via the `importPharmacies` permission
(`src/lib/auth/permissions.ts` — `STAFF`/`VIEWER` do not have it,
`PLATFORM_ADMIN` has zero organization permissions). Enforced by
`requireOrganizationRole("importPharmacies")` /
`requireOrganizationRoleOrRedirect(...)` on every route and action,
including the template-download `route.ts` (its own `getCurrentUser()` +
`hasPermission()` check, since Next.js route handlers don't share the
page-level guard). `organizationId` is always derived from the
authenticated session — never from form data, the uploaded file, the
preview payload, or any client-supplied value. See
`tests/e2e/specs/pharmacy-import-access.spec.ts` and
`tests/integration/pharmacy-excel-import.integration.test.ts`.

## Why persisted, not round-tripped

Unlike historical duty import (which round-trips the raw parsed rows
through a hidden form field between preview and confirm), the preview
here is persisted server-side in `PharmacyImportBatch`/`PharmacyImportRow`
— per that model's own schema comment, this is "not in process memory,
which is not multi-instance-safe on Railway." A batch has a status
(`PREVIEWED` → `IMPORTED`/`EXPIRED`), an `expiresAt` (30 minutes from
creation), and `consumedAt`. The final import step
(`importPharmacyBatchAction`) takes **only** a `batchId` — it reloads
every row from the database, never from client input, so nothing about
row content, `regionId`, `organizationId`, status, or counts can be
tampered with via the browser.

## Template

Two worksheets:

**Eczaneler** — canonical headers, in order: `Bölge`, `Eczane Adı`,
`Eczacı Adı Soyadı`, `Telefon`, `Aktif`.

**Açıklamalar** — explains: required fields, accepted header variants,
accepted phone formats, the default-area-code rule, duplicate rules, the
region prerequisite, the 5 MB file-size limit, the 5,000-row limit, the
all-or-nothing import policy, and that existing rows are not updated in
V1.

## Header aliasing (`src/lib/pharmacy-import/parse-excel.ts`)

Turkish-aware (via the existing `normalizeText()`,
`src/lib/historical/normalize.ts`), case- and whitespace-insensitive.
Region: `Bölge`/`Bolge`/`İlçe`/`Ilce`/`İlçe/İl` (and the `ı`-vs-`i`
Turkish-locale-lowercasing variants — `"Ilce".toLocaleLowerCase("tr")`
produces `"ılce"`, not `"ilce"`, which the alias table accounts for
explicitly). Pharmacy: `Eczane`/`Eczane Adı`/`Eczane Adi`. Pharmacist:
`Eczacı`/`Eczaci`/`Eczacı Adı Soyadı`/`Eczaci Adi Soyadi`. Phone:
`Telefon`/`Telefon No`/`Telefon Numarası`. Active:
`Aktif`/`Aktiflik`/`Durum`.

A duplicate normalized header, or two different header variants mapping
to the same canonical field, is blocking. An unrecognized extra column
is never blocking — surfaced only as an informational
`ignoredColumnWarnings` entry.

## Row validation (`src/lib/pharmacy-import/analyze-import.ts`)

Every row resolves to exactly one status:
`READY` / `INVALID` / `DUPLICATE_IN_FILE` / `ALREADY_EXISTS` /
`UNKNOWN_REGION`. **All-or-nothing**: the whole batch may only be
imported if every row is `READY` — there is no partial/warn-but-import
state (unlike historical duty import's `WARNING` status).

- **Bölge**: required, trimmed, whitespace-collapsed, Turkish-normalized
  match against **this organization's own** regions only (never
  auto-created; an identically-named region in another organization can
  never match). Unmatched → `UNKNOWN_REGION`.
- **Eczane Adı**: required, trimmed/whitespace-collapsed, Turkish
  characters preserved, control characters rejected, max 200 characters.
  `normalizedName` is computed with the exact same `normalizeText()`
  the `Pharmacy.normalizedName` DB unique constraint is built on.
- **Eczacı Adı Soyadı**: required (matches `Pharmacy.pharmacistName`'s
  current non-nullable DB column), same trim/normalize/control-character/
  length rules as the pharmacy name.
- **Telefon**: see "Phone normalization" below.
- **Aktif**: `Evet`/`Hayır`, `true`/`false`, `1`/`0`, `Aktif`/`Pasif`
  (case-insensitive); blank defaults to active. Anything else is
  blocking.
- **Duplicates**: the second (or later) occurrence of the same
  `(regionId, normalizedName)` pair within one file →
  `DUPLICATE_IN_FILE`. A pair that already exists as a real `Pharmacy`
  row in this organization → `ALREADY_EXISTS` (existing rows are never
  updated in V1).

## Phone normalization (`src/lib/pharmacy-import/phone.ts`)

Purely structural — a Turkish area/operator code is always 3 digits,
followed by a 7-digit subscriber number. **Never** infers an area code
from the organization's name, province, region, or slug, or from any
hardcoded mapping.

Accepted: a 10-digit number with no prefix (area + subscriber); a
0-prefixed national number (11 digits); a `+90`- or `90`-prefixed
number; a bare 7-digit local number **only** if the ADMIN supplied a
valid 3-digit "Varsayılan Alan Kodu" on the import form (combined as
`defaultAreaCode + digits`, e.g. `228` + `2121918` →
`+90 228 212 19 18`). If no default area code was entered, a bare
7-digit number is `INVALID` (`PHONE_MISSING_DEFAULT_AREA_CODE`), never
guessed. All numbers already carrying an area code are normalized
independently of the default field. Anything else (wrong digit count,
ambiguous prefix) is `PHONE_UNRECOGNIZED`, rejected — never guessed.

## Populating fields the template doesn't collect

`Pharmacy.address`/`city`/`district` are required (non-null) DB columns
but are not collected by the import row shape. By explicit product
decision: `district` is derived from the matched `Region`'s own
`district` field, `city` from the organization's own `province` field
(both already-known, non-hardcoded values) — `address` is stored as an
empty string, left for the `ADMIN` to fill in via the existing edit form
afterward.

## File security

Inherits, unmodified, the same Step 7 controls the historical-duty-import
upload path already established:
- 5 MB file-size cap, 5,000 data-row cap
  (`src/lib/pharmacy-import/parse-excel.ts`, re-exports
  `MAX_IMPORT_ROWS` from `src/lib/historical/parse-excel.ts`).
- `preflightZipArchive()` (`src/lib/zip-preflight.ts`, unmodified, shared
  by both import features) — ZIP-metadata-only inspection before any
  entry is decompressed: rejects malformed/truncated archives, excessive
  entry counts, oversized entries, high compression ratios (zip-bomb
  shape), unsafe entry paths (absolute paths, Windows drive letters,
  `..` traversal segments), and duplicate entries — all before exceljs
  ever touches the file.
- No formula is ever evaluated; only a formula cell's cached
  `result`/`text` is read (`cellToString()` in `parse-excel.ts`).
- Hidden-only worksheets are rejected.
- See `docs/testing/PHARMACY_EXCEL_IMPORT_TEST.md` for the full
  attack-vector-by-attack-vector test evidence.

## Audit and observability

One `AuditLog` row per successful import
(`entity: "PharmacyImportBatch"`, `action: "CREATE"`), containing only
`sanitizedFileName`, `totalRows`, and `createdCount` — never a pharmacy
name, phone number, or any other row content. Operational log events
(`pharmacy_import_previewed`, `pharmacy_import_completed`,
`pharmacy_import_failed`, `excel_resource_limit_exceeded`,
`excel_upload_rejected`) carry only `requestId`, `userId`, `batchId`,
counts, and reason codes — see
`docs/testing/PHARMACY_EXCEL_IMPORT_TEST.md` for the full privacy
review.
