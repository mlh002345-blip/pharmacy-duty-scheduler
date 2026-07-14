# Organization Onboarding Runbook

Operator procedure for bringing a new pharmacist chamber onto the
platform. See `docs/features/PLATFORM_ORGANIZATION_ADMINISTRATION.md`
for the underlying feature.

## Prerequisites

- You have a `PLATFORM_ADMIN` account. See
  "PLATFORM_ADMIN creation procedure" in
  `docs/operations/MULTI_TENANCY_PRODUCTION_DEPLOYMENT.md` if none
  exists yet.
- You have the chamber's real name, province, and the name/email of the
  person who will be their first `ADMIN`.

## Steps

1. Log in at `/giris` with your `PLATFORM_ADMIN` credentials — you land
   on `/platform/kurumlar`.
2. Click "Yeni Oda Oluştur".
3. Fill in:
   - **Oda Adı** — the chamber's real name (never hardcode a specific
     chamber's name anywhere in code or migrations; this form field is
     the only place it's ever entered).
   - **İl / Bölge** — the chamber's province.
   - **Kısa Ad (slug)** — leave blank to auto-generate from the name
     (Turkish-aware transliteration, e.g. "İzmir Eczacı Odası" →
     `izmir-eczaci-odasi`), or set explicitly if the chamber has a
     preferred short identifier.
   - **Aktif** — leave checked unless you're deliberately staging the
     organization before go-live (an inactive organization's first
     `ADMIN` is also created inactive and cannot log in until you
     activate it).
   - **İlk Yönetici Hesabı** — the first `ADMIN`'s name, email, and a
     temporary password. Communicate the temporary password to them out
     of band (it is never emailed automatically — no SMS/email
     integration exists in this MVP, see `CLAUDE.md`).
4. Submit. The organization and its first `ADMIN` are created in one
   transaction — if anything fails (duplicate slug, duplicate email),
   nothing is created.
5. You land on the organization's summary page
   (`/platform/kurumlar/[id]`). Confirm status is "Aktif" and the new
   `ADMIN` appears under "Yöneticiler".
6. Hand the login URL (`/giris`), the `ADMIN`'s email, and the temporary
   password to the chamber's contact. Instruct them to change the
   password on first login (via `/kullanicilar/[id]/duzenle`, self-edit)
   — there is no forced-password-change-on-first-login flow in this MVP.

## After the first `ADMIN` logs in

The organization's own `ADMIN` (not `PLATFORM_ADMIN`) takes over from
here, entirely inside their own tenant boundary:

1. Create regions (`/bolgeler`) — optional before a bulk import: the
   Excel import discovers unseen region values as candidates the ADMIN
   approves in the preview, so a chamber's full list can be onboarded
   from one workbook (see
   `docs/features/AUTOMATIC_REGION_DISCOVERY.md`). Manual creation
   remains fully available and is still the natural path for a handful
   of regions.
2. Create duty rules per region (`/kurallar`) — required before
   schedule generation, including for regions created by an import.
3. Either create pharmacies manually (`/eczaneler/yeni`) or, for a
   chamber with an existing pharmacy list, use the bulk import — see
   `docs/features/PHARMACY_EXCEL_IMPORT.md`.
4. Add additional users (`STAFF`/`VIEWER`, or a second `ADMIN`) via
   `/kullanicilar`.
5. Optionally import historical duty data via `/gecmis-nobetler` for a
   fairer initial duty-balance calculation.

## Deactivating an organization

Use the status toggle on `/platform/kurumlar/[id]`. This:
- Immediately invalidates every session belonging to that organization's
  users (they are logged out on their next request, not just blocked
  from new logins).
- Is refused if it would leave the platform with zero active
  organizations.
- Never deletes any data — regions, pharmacies, schedules, and audit
  history remain intact and become visible again immediately on
  reactivation.

## What NOT to do

- Do not create a second `Organization` row for a chamber that already
  has one, even temporarily — there is no merge tool. If you create a
  duplicate by mistake, deactivate it immediately (do not delete a
  populated organization; there is no delete action in this MVP).
- Do not hardcode a chamber's name, province, or region list anywhere
  in code, seed scripts, or migrations — every real chamber's data
  enters the system exclusively through this onboarding flow or the
  chamber's own `ADMIN` afterward.
