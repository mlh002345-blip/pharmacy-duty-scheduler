# Login Rate Limit & Proxy Trust — Live Railway Verification Checklist

This document is a **manual, live-environment checklist**. It cannot be
run from the repository alone — it requires an actual deployed
(production or staging) Railway environment. Do not flip
`TRUST_PROXY_HEADERS=true` in production before completing section A
against that same environment.

Background: `src/lib/security/client-identity.ts` defaults to **not**
trusting any client-supplied IP header, because this repository contains
no `railway.json`/`railway.toml`/`nixpacks.toml`/`Dockerfile` and no code
anywhere previously read `x-forwarded-for`/`x-real-ip`/`forwarded`/
`cf-connecting-ip`/`request.ip` — so there is nothing in the repo that
proves what Railway's edge does to that header before the request reaches
this Node process. This checklist is how that gets proven, once, against
the real deployment, before the flag is ever enabled.

## A. Header trust test

Goal: determine whether Railway overwrites, appends to, or blindly
preserves a client-supplied `X-Forwarded-For` value, and which position
in a comma-separated chain actually reflects the real client.

1. With `TRUST_PROXY_HEADERS` still unset/`false` in the target
   environment, send a request with a forged header, e.g.:
   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" \
     -H "X-Forwarded-For: 1.2.3.4" \
     https://<your-railway-domain>/giris
   ```
2. Trigger a login failure from that same request (submit the login form
   with a wrong password) and inspect Railway's log output for the
   `auth_login_failed` line's `requestId`. Since `TRUST_PROXY_HEADERS` is
   still off, this alone does **not** prove anything about the header
   yet — it only confirms the request reached the app. The header itself
   must be inspected via a temporary diagnostic (see step 4) rather than
   inferred from rate-limit behavior while the flag is off.
3. Repeat step 1 with a different forged value (e.g. `9.9.9.9`) and, if
   possible, from a different real network (a different Wi-Fi/mobile
   connection, or a colleague on a different network) to get a real,
   distinct client IP to compare against.
4. Temporarily and only for this diagnostic session, add a throwaway log
   line (or use Railway's own request logging/observability, if
   available) that prints the **raw, full** `X-Forwarded-For` header
   value Railway delivers to the Node process for each of the requests
   above. **Do not leave this temporary logging in place** — printing
   the full header value is exactly what
   `src/lib/security/client-identity.ts`'s design deliberately avoids in
   normal operation (a forwarding-header chain can itself be sensitive
   metadata), so this step is diagnostic-only and must be reverted
   immediately after.
5. Compare: does the value your forged header claimed (`1.2.3.4`) survive
   unchanged, does Railway append the real client IP after it (a
   comma-separated chain with your forged value first), or does Railway
   discard/overwrite it entirely with only the real client IP?
6. Record the actual result here (fill in after running):
   - Header observed: `_____________________`
   - Chain position of the real, non-spoofable client IP:
     `_____________________` (first / last / only entry / other)
   - Date verified: `_____________________`
   - Verified by: `_____________________`
7. **Only if** the real client IP is confirmed to always be the **last**
   entry in `X-Forwarded-For` (matching
   `src/lib/security/client-identity.ts`'s current assumption,
   documented in its own comments) is it safe to set
   `TRUST_PROXY_HEADERS=true`. If Railway's behavior differs (e.g. the
   real IP is first, or a different header entirely is authoritative),
   **do not enable the flag** — file a follow-up to adjust
   `TRUSTED_FORWARD_HEADER`/`extractTrustedCandidate()` in
   `client-identity.ts` to match the actual observed behavior first.

## B. Rate-limit test

Goal: confirm the account-dimension rate limit (which works regardless
of `TRUST_PROXY_HEADERS`) behaves as designed against the real deployed
app and real PostgreSQL.

1. Using a real (or disposable test) account's email, perform 4 wrong-
   password login attempts through the actual `/giris` page.
2. Confirm no block yet — the 4th attempt still returns
   `"Hatalı e-posta veya şifre."`, not the rate-limit message.
3. Perform the 5th (threshold) attempt. It is still processed normally
   (still returns the generic wrong-credentials message) — the block
   takes effect starting with the *next* attempt, not this one.
4. Attempt a 6th time (even with the correct password). Confirm you now
   see: `"Çok fazla başarısız giriş denemesi yapıldı. Lütfen bir süre
   sonra tekrar deneyin."`
5. Try the *correct* password again during the cooldown window (~15
   minutes from the 5th attempt) and confirm it is still rejected with
   the same rate-limit message, not a raw error and not the generic
   wrong-credentials message.
6. Wait out the cooldown (or, in a staging environment only, directly
   update the `LoginAttempt` row's `blockedUntil`/`windowStart` columns
   to simulate elapsed time — never do this against production data) and
   confirm a correct-password attempt succeeds again afterward.
7. Repeat steps 1–4 from a different network/IP if possible, to observe
   whether the network dimension (only meaningful once
   `TRUST_PROXY_HEADERS=true` has been verified per section A) also
   engages independently of the account dimension.
8. Verify Railway's log output contains `auth_login_rate_limited` lines
   with a `requestId`, `dimension`, and `retryAfterSeconds` field, and
   confirm — by reading the actual log line, not just trusting the code
   — that it contains **no** email address, password, or session
   token/cookie value anywhere in the line.

## C. Multi-instance limitation

Goal: confirm whether the limiter's PostgreSQL-backed storage is in fact
shared correctly across replicas, if Railway ever runs more than one.

1. Check Railway's dashboard for the service's current replica count.
2. If more than one replica is running:
   - Repeat the section B test, but attempt to route different requests
     to different replicas if Railway's load balancing allows targeting
     (e.g. via multiple rapid requests, or Railway's own per-instance
     diagnostics if available).
   - Confirm the failure count observed in step B still accumulates
     correctly to a single, shared total (proving the PostgreSQL-backed
     design — not a per-process in-memory counter — since counters would
     appear to "reset" or diverge per replica if state were process-local).
3. If only one replica is running (the common case for this app's
   current deployment shape, matching the single-long-lived-Node-process
   model already documented in
   `docs/security/09-algorithmic-complexity-hot-paths.md`): record that
   explicitly here — this test cannot be meaningfully exercised with a
   single replica, and that is expected, not a failure. Re-run this
   section if the replica count is ever increased.
4. Record the result here:
   - Replica count observed: `_____________________`
   - Shared-state behavior confirmed (Y/N/N-A single replica):
     `_____________________`
   - Date verified: `_____________________`

## Notes

- None of the steps above require, and none should ever involve,
  destructive operations against production data beyond the disposable
  `LoginAttempt` rows the test attempts themselves create (which
  self-expire via the normal window/cooldown mechanism — no manual
  cleanup is required in production; only step B.6's "simulate elapsed
  time" shortcut should ever touch `LoginAttempt` rows directly, and only
  in a staging environment).
- If any step in section A cannot be completed with confidence, leave
  `TRUST_PROXY_HEADERS` unset. The account-dimension of the rate limiter
  provides real protection on its own even with the network dimension
  disabled — see `docs/security/21-login-rate-limit-proxy-validation.md`.
