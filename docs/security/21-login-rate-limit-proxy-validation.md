# Login Rate Limiting & Trusted Proxy/IP Validation

Date: 2026-07-10, same branch (`deploy/postgresql-demo`). Pre-pilot test
plan, Step 2. Builds directly on the CONFIRMED MEDIUM finding from
`docs/security/20-verification-false-positive-filter.md` ("No login rate
limiting / lockout") and the CONFIRMED LOW finding ("No brute-force
alerting on now-logged login failures").

## Threat model

An unauthenticated attacker with network access to `/giris` can submit
unlimited password guesses against any known or guessed email address
(credential stuffing / brute force). Prior to this pass, nothing bounded
attempt volume — `loginAction` performed a full `scrypt` verification for
every submitted password with no counter, delay, or lockout of any kind.
The account-existence and account-status enumeration issues that made
*targeted* guessing easier were already fixed in
`docs/security/02-authentication-session-handling.md`; this pass adds the
missing volume control.

Two related but separate risks are addressed:

1. **Credential stuffing against a specific account** — an attacker
   with a known/guessed email tries many passwords against it. Mitigated
   by the **account dimension** of the rate limiter, which works
   regardless of network/proxy configuration.
2. **Distributed brute force from a single attacker across many
   accounts, or high-volume traffic from a single network** — harder to
   mitigate without a trustworthy client-IP signal, which this
   repository could not prove exists (see "Proxy trust assumptions"
   below). Mitigated by the **network dimension**, but only once
   `TRUST_PROXY_HEADERS` has been verified and enabled per
   `docs/testing/LOGIN_RATE_LIMIT_PROXY_TEST.md` — until then, every
   request shares one conservative, non-identifying bucket, which still
   provides *some* protection (a global ceiling on unauthenticated
   traffic volume against the login endpoint) but cannot distinguish one
   attacker's network from another's.

**Explicitly out of scope for this pass** (per the task's own
constraints): the login page was not redesigned, the existing generic
failure message (`"Hatalı e-posta veya şifre."`) is unchanged and remains
the response for every ordinary credential failure, account existence/
status is still never revealed, and no external service (Redis, a
dedicated rate-limit SaaS) was introduced.

## Client-IP / proxy trust audit findings

Before writing any limiter code, the existing request/proxy context was
audited:

- `src/middleware.ts` — confirmed to only stamp/forward an `x-request-id`
  correlation header (added in
  `docs/security/16-logging-observability-auditability.md`); it is
  explicitly documented in its own comments as **not** an auth gate and
  does not touch any client-IP header.
- Repo-wide search for `x-forwarded-for`, `x-real-ip`, `forwarded`,
  `cf-connecting-ip`, `request.ip`, and `headers()` usage: **zero** prior
  code anywhere read or trusted any client-IP-bearing header. The one
  false-positive match (`forwardedHeaders` in `middleware.ts`) is a local
  variable name for the request-ID header being forwarded downstream —
  unrelated to `X-Forwarded-For` semantics.
- `docs/DEPLOYMENT.md` and every existing `docs/security/*.md` file: no
  `railway.json`, `railway.toml`, `nixpacks.toml`, or `Dockerfile` exists
  anywhere in this repository (re-confirmed in this pass, consistent with
  the same finding in protocols 14/15/20), so there is **no
  repository-inspectable proof** of what Railway's edge does to a
  client-supplied `X-Forwarded-For` value before the request reaches this
  Node process — whether it overwrites it, appends to it, or passes it
  through unchanged.
- Conclusion, stated without inventing unverifiable Railway behavior: the
  app **cannot currently distinguish direct client input from any
  Railway-added proxy header**, because it never inspected either. This
  is exactly the gap `src/lib/security/client-identity.ts` is designed
  around — defaulting closed until proven otherwise.

## Chosen limiter dimensions

Two independent dimensions, both required by the task, both enforced
regardless of proxy trust configuration:

- **ACCOUNT** — a one-way SHA-256 digest of the normalized (trimmed,
  lowercased) submitted email, computed via `hashAccountIdentifier()` in
  `src/lib/auth/login-rate-limit.ts`. Tracked even for a nonexistent
  account — this is what lets the limiter block sustained guessing
  against an unknown/guessed email without ever revealing whether that
  email exists (the rate-limit response is identical either way).
- **NETWORK** — derived from `getClientIdentity()` in
  `src/lib/security/client-identity.ts`. When `TRUST_PROXY_HEADERS` is
  not enabled (the default), every request shares one fixed,
  non-identifying bucket (`UNTRUSTED_NETWORK_BUCKET_KEY`) — this still
  provides a blunt, global ceiling on unauthenticated login volume, but
  cannot distinguish one attacker's network from another's until the
  flag is verified and enabled per
  `docs/testing/LOGIN_RATE_LIMIT_PROXY_TEST.md`.

Neither dimension ever stores or logs a raw email or raw IP address —
only SHA-256 digests via `src/lib/security/hash-identifier.ts`'s
`hashIdentifier()`.

## Storage model

**PostgreSQL-backed** (new `LoginAttempt` table), not in-memory.

### Why not in-memory

The task requires assessing this explicitly. An in-memory (module-level
`Map`) limiter is **insufficient** here for a reason directly
attributable to this app's own deployment shape, already documented
elsewhere in this repository: Railway restarts the Node process on every
deploy. A security control that silently resets to zero on every
redeploy — including, worst case, an operator redeploying *in direct
response to* an active brute-force incident — is not an acceptable
tradeoff for a rate limiter, even though a similar in-memory approach was
judged acceptable for the *non-security*, purely-informational
data-health TTL cache in
`docs/security/09-algorithmic-complexity-hot-paths.md` (whose staleness
has no security consequence). The task's own stated insufficiency
criteria are all plausible here: this app's current topology is a single
long-lived process (documented in protocol 09), but that process **does**
restart on every deploy, and the design must not assume it will never be
scaled to multiple replicas in the future — a PostgreSQL-backed limiter
is correct under both topologies with no code change if replica count
ever changes, whereas an in-memory one would silently stop working
correctly the moment a second replica was introduced.

**No Redis or external cache was added.** PostgreSQL is already a hard
dependency of this app; introducing a second stateful service purely for
rate-limit counters was judged an unnecessary increase in operational
surface for a low-volume internal chamber-staff login endpoint, per the
task's own preference for a PostgreSQL-backed approach "if no external
cache is allowed."

### Schema

```prisma
model LoginAttempt {
  id           String    @id @default(cuid())
  bucketType   String
  bucketKey    String
  failureCount Int       @default(0)
  windowStart  DateTime
  blockedUntil DateTime?
  updatedAt    DateTime  @updatedAt

  @@unique([bucketType, bucketKey])
  @@index([blockedUntil])
  @@index([windowStart])
}
```

One row per `(bucketType, bucketKey)` pair — `bucketType` is `"NETWORK"`
or `"ACCOUNT"`; `bucketKey` is always a SHA-256 hex digest, never a raw
email or IP. **No raw email or IP address is ever stored.**

### Migration

`prisma/migrations/20260710140000_login_attempt_rate_limit/migration.sql`
— a single `CREATE TABLE` plus three indexes (the compound unique index
plus two supporting indexes for future cleanup/lookup by `blockedUntil`/
`windowStart`). No existing table or column was altered; this is a purely
additive migration with nothing to backfill (the table starts empty).

### Retention

Not actively purged in this pass — rows are small and bounded by the
number of distinct `(bucketType, bucketKey)` pairs actually attempted.
This mirrors the same accepted, documented-only pattern already used for
the `Session` table (`docs/security/10-memory-unbounded-growth.md`,
finding 3: "Expired Session rows have no cleanup... left unfixed: adding
a retention/cleanup job is a new piece of infra... out of scope"). A
scheduled cleanup of long-expired `LoginAttempt` rows (e.g.
`windowStart` and `blockedUntil` both far in the past) would be a
reasonable, small future addition using the same indexes already added
here — not implemented now, per the task's explicit instruction not to
build a broad security-events subsystem in this pass.

## Threshold, window, cooldown

- **Threshold**: `MAX_FAILED_ATTEMPTS = 5` failed attempts.
- **Window**: `WINDOW_MS = 15 minutes` — a failure older than this
  resets the counter to a fresh window on the next attempt.
- **Cooldown**: `COOLDOWN_MS = 15 minutes` from the attempt that crossed
  the threshold.
- Accounts are **never permanently locked** — the block is always
  time-bound, and the window itself naturally decays even without a
  successful login.
- A successful login calls `clearAccountLoginRateLimit()`, which deletes
  only the **ACCOUNT**-dimension row for that identifier — the shared
  **NETWORK** bucket (when untrusted) or the attacker's own network
  bucket (when trusted) is deliberately left untouched, per the task's
  "clear or reduce the account-specific failure state" requirement,
  which is scoped to the account dimension only.
- **Inactive-account and wrong-password failures follow identical
  external behavior**: both call `recordLoginFailure()` and both return
  the same generic message, exactly as before this pass — the rate
  limiter adds no new distinguishing signal between these two failure
  reasons anywhere the client can observe.
- **Validation (zod) failures are never counted** — `loginAction` only
  calls the rate limiter after `loginSchema.safeParse()` succeeds, since
  a malformed form submission (e.g. an empty field) never constitutes a
  real credential attempt.
- **Rate-limit rejection uses a distinct, neutral message** —
  `"Çok fazla başarısız giriş denemesi yapıldı. Lütfen bir süre sonra
  tekrar deneyin."` — shown identically whether the triggering dimension
  was ACCOUNT or NETWORK, and identically whether or not the submitted
  email corresponds to a real account (the pre-check runs *before* the
  database lookup for the account, so a rate-limited request never even
  reaches `prisma.user.findUnique`).

## Proxy trust assumptions

`TRUST_PROXY_HEADERS` defaults to unset/`false`. When enabled, only
`X-Forwarded-For` is read, and only its **last** comma-separated entry is
trusted (the conservative, industry-standard "trust only the hop your own
immediate reverse proxy appended" rule) — every earlier entry can be
freely set by the client itself. This assumption is **explicitly
unverified against the real Railway deployment** and is called out as
such in `client-identity.ts`'s own comments. **Do not enable
`TRUST_PROXY_HEADERS=true` in any real environment before completing
section A of `docs/testing/LOGIN_RATE_LIMIT_PROXY_TEST.md` against that
exact environment.**

Header validation, independent of the trust decision:
- Header values over 512 characters are rejected outright (oversized
  headers are treated as untrusted/malformed, never partially parsed).
- Each candidate is validated as a real IPv4 or IPv6 literal via Node's
  built-in `node:net` `isIP()` — not a hand-rolled regex.
- A bracketed IPv6 literal (`[::1]:443`) is unwrapped; an `ipv4:port`
  pair has its port stripped; a bare IPv6 address (which itself contains
  multiple colons) is never mistaken for a `host:port` pair.
- IPv6 addresses are lowercased for consistent hashing.
- Any failure at any of the above steps falls back to the same fixed,
  non-identifying untrusted bucket — never an error, never a crash.

## Race-safety mechanism

`recordLoginFailure()`'s increment is a single
`INSERT ... ON CONFLICT ("bucketType", "bucketKey") DO UPDATE` statement
per dimension (`src/lib/auth/login-rate-limit.ts`). Postgres resolves a
unique-index conflict by taking a row-level lock before applying the
`UPDATE`, so two genuinely concurrent calls for the same bucket key are
serialized by the database itself — the second call's `UPDATE` always
observes the first call's already-committed increment. This is proven
against real concurrent writes (not a mocked rejection) in
`tests/integration/login-rate-limit-concurrency.integration.test.ts`,
which launches two truly overlapping `recordLoginFailure` calls (and,
separately, two overlapping real `loginAction` calls) via the same
deferred-promise gate pattern used by the rest of the integration suite,
and asserts the persisted `failureCount` reflects both increments exactly
— no lost update. Setting `blockedUntil` once the threshold is crossed is
a second, idempotent `updateMany(... WHERE blockedUntil IS NULL)` — safe
even if two concurrent callers both cross the threshold at once, since
the second call's `updateMany` simply affects zero rows without erroring.

## Logging behavior

New event: `auth_login_rate_limited` (warn level), logged exactly once
per rate-limited request (not once per underlying counter check) with
`requestId`, `dimension` ("NETWORK" or "ACCOUNT"), and
`retryAfterSeconds` — never the account/network bucket key itself, an
email, a password, a session token, a cookie, `DATABASE_URL`, or the
forwarding-header chain. The pre-existing `auth_login_failed` (warn) and
`auth_login_succeeded` (info) events are unchanged in shape and
continue to fire exactly as before this pass.

**No per-request flood risk**: `auth_login_rate_limited` only fires when
a request is actually rejected as blocked — a sustained brute-force flood
against a blocked account produces one log line per rejected request
(bounded by the attacker's own request rate, same as `auth_login_failed`
already was before this pass), not an amplified volume. No additional
sampling was added since this event is inherently already bounded to
"attempts after the account/network is blocked," which is a small
fraction of a real flood's total volume (the first 5 attempts still log
`auth_login_failed`, exactly as before).

## Privacy and retention

- Neither dimension's bucket key is ever a raw, reversible identifier —
  both are SHA-256 digests with a fixed namespace prefix
  (`src/lib/security/hash-identifier.ts`). This app has no session-
  signing secret (documented in `docs/security/14-configuration-
  environment-hardening.md`), so this is a **namespaced digest, not a
  keyed HMAC** — sufficient to keep raw emails/IPs out of the
  `LoginAttempt` table and log stream, but not a cryptographic secrecy
  boundary against an attacker who already has database read access and
  a short list of candidate emails/IPs to brute-force against the digest.
  This tradeoff is intentional and documented, not an oversight.
- `LoginAttempt` rows contain no PII beyond the digest itself, no
  timestamps tied to a specific browser/device beyond `windowStart`/
  `blockedUntil`/`updatedAt`, and are never joined to `User` in any query
  (the ACCOUNT bucket is keyed purely by the digest, independent of
  whether a matching `User` row exists).
- See "Retention" above — no active purge in this pass, same accepted
  pattern as the existing `Session` table.

## Remaining limitations

- **Network-dimension protection is inert until `TRUST_PROXY_HEADERS` is
  verified and enabled** — see "Proxy trust assumptions" above and
  `docs/testing/LOGIN_RATE_LIMIT_PROXY_TEST.md`, section A. Until then,
  the account dimension is the only per-identifier protection; the
  network dimension only provides a blunt, shared ceiling.
- **Only two-way concurrency is proven** by the integration suite (same
  limitation already documented for the rest of the integration suite in
  `docs/security/20-verification-false-positive-filter.md`, UNVERIFIED
  item 5) — a genuinely 3+-way simultaneous race is not separately
  tested, though the same single-statement atomic-upsert mechanism
  applies regardless of how many concurrent callers there are.
- **No automated alerting on `auth_login_rate_limited` volume** — same
  gap already documented in `docs/security/20-verification-false-
  positive-filter.md` (CONFIRMED item 4) for `auth_login_failed`; this
  pass adds the *blocking* mechanism itself but not a dashboard/alert on
  top of the new event.
- **Retention/cleanup of old `LoginAttempt` rows is not automated** — see
  "Retention" above.
- **Multi-instance behavior is unverified live** — see
  `docs/testing/LOGIN_RATE_LIMIT_PROXY_TEST.md`, section C. The
  PostgreSQL-backed design is correct under multiple replicas by
  construction (shared database state, not per-process memory), but this
  has not been observed against a real multi-replica Railway deployment
  in this pass.
- **The hashing namespace is not a cryptographic secret** — see
  "Privacy and retention" above.

## Exact live Railway checks still required

See `docs/testing/LOGIN_RATE_LIMIT_PROXY_TEST.md` in full. Summary:

1. **Section A (header trust)** — must be completed and its result
   recorded before `TRUST_PROXY_HEADERS=true` is ever set in production.
2. **Section B (rate-limit behavior)** — should be run once against the
   real deployed app to confirm end-to-end behavior matches this
   document's stated policy, independent of the header-trust question.
3. **Section C (multi-instance)** — should be run if/when Railway's
   replica count for this service is ever increased above one.

## Verification performed

- `npx tsc --noEmit` — clean
- `npm run lint` — clean
- `npm test` — 427/427 passing (57 new tests: 15 in `actions.test.ts`
  (extended), 21 in `client-identity.test.ts` (new), 14 in
  `login-rate-limit.test.ts` (new), plus the existing suite unchanged)
- `npm run test:preflight` — passes against a dedicated
  `TEST_DATABASE_URL` (`pharmacy_duty_scheduler_test`)
- `npm run test:integration` — 13/13 passing across 7 files (6 new
  rate-limit-concurrency tests plus the pre-existing 6 files/8 tests from
  the prior integration suite, unchanged), run twice consecutively with
  identical results; direct `psql` inspection confirmed zero leaked
  `LoginAttempt`/`User`/`Session` rows after both runs
- `npm run build` — production build succeeds against a real local
  PostgreSQL instance with the new migration applied, all routes
  registered
- Migration applied to local PostgreSQL via `npx prisma migrate deploy`;
  `npx prisma migrate status` confirms "Database schema is up to date!"
  both immediately after applying and on a subsequent run
- No production database was touched at any point in this pass — all
  verification used the same local PostgreSQL instances already
  established for prior pre-pilot work (`pharmacy_duty_scheduler` for
  `npm test`/`npm run build`, `pharmacy_duty_scheduler_test` — guarded by
  `tests/integration/helpers/test-db-guard.ts` — for
  `npm run test:integration`/`npm run test:preflight`)
- The existing generic login failure message
  (`"Hatalı e-posta veya şifre."`) is confirmed byte-identical to before
  this pass for every ordinary credential failure (unknown account, wrong
  password, inactive account) — locked in by the pre-existing
  "all three failure messages are textually identical" test, unchanged
- No email, password, session token, cookie, or forwarding-header chain
  value appears in any log line emitted by the new code — confirmed by
  dedicated assertions in `actions.test.ts`'s logging test suite
