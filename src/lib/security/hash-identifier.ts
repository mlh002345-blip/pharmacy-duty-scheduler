import { createHash } from "node:crypto";

// One-way digest used to turn a sensitive identifier (an email address, a
// client IP) into an opaque, non-reversible bucket key before it is ever
// stored in the database or included in a log line. This app has no
// signing/session secret (sessions are opaque DB-backed tokens, not
// signed — see src/lib/auth/session.ts), so this is a fixed, non-secret
// namespace prefix rather than a keyed HMAC: it is sufficient to prevent
// raw emails/IPs from appearing in the LoginAttempt table or in logs, but
// it is NOT a cryptographic secret boundary — an attacker with read
// access to this table or the source code could brute-force a digest back
// to a known/guessed value (e.g. a short list of candidate emails). This
// is an acceptable tradeoff for a rate-limit routing key (which only ever
// needs to answer "is this the same identifier as before?", not "keep
// this identifier confidential against a targeted guess") and is
// documented in docs/security/21-login-rate-limit-proxy-validation.md.
const NAMESPACE_PREFIX = "pharmacy-duty-scheduler:login-rate-limit:v1:";

export function hashIdentifier(value: string): string {
  return createHash("sha256").update(NAMESPACE_PREFIX + value).digest("hex");
}
