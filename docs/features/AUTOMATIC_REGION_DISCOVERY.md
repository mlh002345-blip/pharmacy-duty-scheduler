# Automatic Region Discovery (Pharmacy Excel Import)

Branch `feature/automatic-region-discovery`. Extends the generic
Pharmacy Excel Import (`docs/features/PHARMACY_EXCEL_IMPORT.md`) so an
organization `ADMIN` can upload one workbook **without first creating
every region manually**: unique region values are extracted as
candidates, reviewed and approved in the preview, and created together
with the pharmacies in one all-or-nothing PostgreSQL transaction.

The product stays province- and organization-independent: no province,
district, region, organization, telephone area code, or pharmacy list is
hardcoded anywhere; no external network request, maps API, geocoding
service, or AI service is ever used; matching happens only against the
authenticated organization's own regions.

## Manual region management is unchanged

`Nöbet Bölgeleri` (`/bolgeler`) keeps its full manual workflow: **Yeni
Bölge Ekle**, **Düzenle**, **Aktif/Pasif** toggle. Region mutation now
requires the dedicated ADMIN-only `manageRegions` permission
(`src/lib/auth/permissions.ts`) — `STAFF`/`VIEWER` cannot mutate
regions, `PLATFORM_ADMIN` has no tenant-region access at all.
Deactivation never deletes pharmacies, schedules, history, or audit
logs; an inactive region is refused for NEW schedule generation
(enforced server-side in `createDutyScheduleAction`, not just by the
UI filter — added with this feature as a defect fix + regression test)
and can be reactivated later.

## Template

Canonical columns: `Bölge`, `İlçe`, `Eczane Adı`, `Eczacı Adı Soyadı`,
`Telefon`, `Adres`, `Aktif`. `Eczane Adı`/`Eczacı Adı Soyadı`/`Telefon`
are mandatory headers; at least one of `Bölge`/`İlçe`/`Adres` must be
present (old templates — including ones whose only region column used an
`İlçe` header — keep working unchanged). `Adres` is optional per row
(max 500 chars, control characters rejected, Turkish preserved).
Accepted harmless header variants are listed in the template's
Açıklamalar sheet and `src/lib/pharmacy-import/parse-excel.ts`
(`Nöbet Bölgesi`, `İlçe Adı`, `Eczane Adresi`, `Açık Adres`, …).
Duplicate normalized headers remain blocking; formula-injection
escaping, the 5 MB/5.000-row limits, and every ZIP/XLSX preflight
control are unchanged.

## Region source priority (per row)

1. Explicit `Bölge` value — strongest.
2. Explicit `İlçe` value — used as the proposed region name when Bölge
   is blank.
3. Address-derived suggestion — **suggestion only**, never used without
   explicit ADMIN approval.
4. ADMIN manual selection during preview.

Address parsing (`src/lib/pharmacy-import/region-discovery.ts`) is
purely structural: only the conventional endings
`"..., <İlçe> / <İl>"` and `"..., <İlçe>, <İl>"` yield a suggestion
(e.g. "İsmetpaşa Mahallesi, Bozüyük / Bilecik" → `Bozüyük`;
"Cumhuriyet Mah. Merkez/Bilecik" → `Merkez`). Multi-slash or
implausible (digit-bearing) endings are AMBIGUOUS; plain street text
yields nothing. Ambiguity is never guessed away — those rows stay
unresolved until the ADMIN decides. Region inference never uses the
organization name/slug and no national province/district mapping exists
in the codebase.

## Candidate aggregation and statuses

Repeated values collapse into one candidate per Turkish-normalized
string (`normalizeText` — the same normalization the DB uniqueness is
built on), with a per-candidate row count. Statuses:
`MATCHED_EXISTING_ACTIVE`, `MATCHED_EXISTING_INACTIVE`,
`NEW_REGION_CANDIDATE`, `ADDRESS_SUGGESTION`, `AMBIGUOUS`, `UNRESOLVED`,
`EXCLUDED_BY_ADMIN`. A candidate from another organization can never
match — the matcher only ever receives this organization's own regions.

## Preview UI (`/eczaneler/ice-aktar/onizleme/[batchId]`)

Two sections:

**A. Bölge Eşleştirme ve Onay** — one panel per candidate showing the
Excel value, source (Bölge sütunu / İlçe sütunu / Adres önerisi /
Manuel), row count, matched region (with active/passive badge),
proposed name/city/district/active, and status. ADMIN actions: match to
an existing region, approve as a new region, edit the proposal, choose
active/passive, accept or reject an address suggestion, undo a
decision, define a manual candidate (Bölge Adı / İl / İlçe /
Aktif-Pasif), or exclude the candidate from this import. Manual
candidates are stored server-side only as candidates; `organizationId`
always derives from the session through the parent batch; duplicates
against existing regions and against other candidates are detected.
**No Region row is ever written before final import confirmation.**

**B. Eczane Ön İzleme** — every row with row number, region resolution,
pharmacy/pharmacist/phone/address/active, status, and message; rows
with no usable source get a candidate-assign select. The import button
renders only when every row is READY or EXCLUDED (with ≥1 READY) —
unresolved/ambiguous/invalid/duplicate rows block it.

## Inactive-region behavior

A candidate matching an inactive region requires an explicit decision —
never silent: keep it inactive (pharmacies import into it and stay out
of new schedules until activation) or reactivate it (performed inside
the final transaction and written to the AuditLog). New candidates
default to active; the ADMIN may approve a candidate as a new
**inactive** region — its pharmacies import but do not participate in
new schedules until the region is activated from `Nöbet Bölgeleri`.

## Final all-or-nothing transaction (`importPharmacyBatchAction`)

One `prisma.$transaction`, in order: consume-first conditional status
flip (row lock; a double-submit deterministically fails) → full row
recompute from current DB state (`recomputePharmacyImportRows` — the
persisted preview is never trusted) → matched-region ownership and
activity recheck → approved new regions created (an identically-named
active region that appeared meanwhile is reused, never duplicated; an
inactive one aborts for a human decision; the `(organizationId, name)`
unique constraint is the final authority) → explicitly approved
reactivations (audited per region) → pharmacies created for READY rows
only (EXCLUDED rows skipped; `(regionId, normalizedName)` constraint as
final authority) → one batch AuditLog with counts. Any failure rolls
back everything: no region, no activation change, no pharmacy, no
success AuditLog; the batch returns to `PREVIEWED` for a safe retry.
Batch consumption is organization- **and creator-**scoped: only the
ADMIN who uploaded the file may edit candidates or confirm the import.

Field derivation: `pharmacy.address` = imported Adres (trimmed,
validated; blank → empty string as before); `pharmacy.district` = the
final region's own district; `pharmacy.city` = the ADMIN-approved
candidate city for newly created regions (defaulted to the
organization's own province), the organization's province otherwise.
`Region.district` = explicit İlçe → approved candidate value → ADMIN
input, with the candidate value itself as the final fallback.

## Logging and privacy

Safe structured events: `pharmacy_import_region_candidates_discovered`,
`pharmacy_import_region_candidate_updated` / `_approved` / `_rejected`,
`pharmacy_import_regions_created`, `pharmacy_import_regions_reactivated`,
`pharmacy_import_region_resolution_failed` — carrying only requestId,
organizationId, batchId, counts, and safe reason codes. No pharmacy
name, pharmacist name, address, phone, raw candidate text, workbook
content, formula, token, password, or DATABASE_URL is ever logged (the
shared logger's redaction guarantees apply unchanged).

## Persistence

`PharmacyImportRegionCandidate` (see `prisma/schema.prisma` and the
additive migration `20260713121118_pharmacy_import_region_discovery`):
batch-owned (cascade delete, so expiry cleanup covers candidates),
unique per `(batchId, normalizedSourceValue)`, `matchedRegionId`
SetNull. `PharmacyImportRow` gains nullable
`sourceRegionText`/`sourceDistrictText`/`address`/`candidateId`
(SetNull). No workbook binary, no raw formula content, no
client-controllable organizationId. Batches persisted before this
feature keep importing (rows with a server-assigned `regionId` and no
candidate stay resolved).

## Test evidence

See `docs/testing/PHARMACY_EXCEL_IMPORT_TEST.md` — unit
(region-discovery + analyzer + parser), 12 real-Postgres integration
tests (`tests/integration/region-discovery-import.integration.test.ts`),
and 5 real-browser E2E tests (`tests/e2e/specs/region-discovery.spec.ts`).
