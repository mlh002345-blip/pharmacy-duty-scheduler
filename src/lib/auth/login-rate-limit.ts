import { randomUUID } from "node:crypto";

import { prisma } from "@/lib/prisma";
import { hashIdentifier } from "@/lib/security/hash-identifier";

// PostgreSQL-backed login-attempt rate limiter.
//
// WHY NOT IN-MEMORY: an in-process counter would reset on every deploy
// (Railway restarts the process on every deploy) and would not be shared
// across replicas if this app is ever scaled beyond one instance. A
// security control that resets itself exactly when an operator redeploys
// — including, worst case, redeploying *in response to* an active
// brute-force incident — is not an acceptable tradeoff, so this is
// PostgreSQL-backed via the LoginAttempt table (see
// prisma/migrations/20260710140000_login_attempt_rate_limit) rather than
// a module-level Map. See docs/security/21-login-rate-limit-proxy-validation.md
// for the full reasoning.
//
// Two independent dimensions are tracked as separate rows, keyed by
// (bucketType, bucketKey):
//   - "NETWORK": derived from src/lib/security/client-identity.ts. When
//     TRUST_PROXY_HEADERS is not enabled, every request shares one fixed,
//     non-identifying bucket — see that module for why.
//   - "ACCOUNT": a one-way digest of the normalized, lowercased email the
//     login form was submitted with (never the raw email — see
//     src/lib/security/hash-identifier.ts). Tracked even for a
//     nonexistent account, which is what lets the limiter block
//     credential-stuffing against an unknown/guessed email without ever
//     revealing whether that email exists.
//
// RACE SAFETY: recordLoginFailure's increment step is a single
// INSERT ... ON CONFLICT (...) DO UPDATE statement. Postgres resolves a
// unique-constraint conflict by taking a row-level lock before applying
// the UPDATE, so two truly concurrent calls for the same bucket key are
// serialized by the database itself — the second call's UPDATE always
// sees the first call's already-applied increment, never a stale read.
// This is proven against real concurrent writes in
// tests/integration/login-rate-limit-concurrency.integration.test.ts.

export const MAX_FAILED_ATTEMPTS = 5;
export const WINDOW_MS = 15 * 60 * 1000; // 15 minutes
export const COOLDOWN_MS = 15 * 60 * 1000; // 15 minutes

export type RateLimitDimension = "NETWORK" | "ACCOUNT";

export type RateLimitCheckResult =
  | { blocked: false }
  | { blocked: true; dimension: RateLimitDimension; retryAfterSeconds: number };

export type RateLimitKeys = {
  networkBucketKey: string;
  accountBucketKey: string;
};

/** Normalizes an email the same way `loginAction` already does before comparing against `User.email`. */
export function hashAccountIdentifier(email: string): string {
  return hashIdentifier(email.trim().toLowerCase());
}

function secondsUntil(date: Date, now: Date): number {
  return Math.max(1, Math.ceil((date.getTime() - now.getTime()) / 1000));
}

/**
 * Read-only check — call before attempting password verification. Does
 * not write anything, so it's safe to call even when the request will
 * turn out to be a validation failure that should not otherwise be
 * counted.
 */
export async function checkLoginRateLimit(keys: RateLimitKeys): Promise<RateLimitCheckResult> {
  const now = new Date();
  const rows = await prisma.loginAttempt.findMany({
    where: {
      OR: [
        { bucketType: "NETWORK", bucketKey: keys.networkBucketKey },
        { bucketType: "ACCOUNT", bucketKey: keys.accountBucketKey },
      ],
    },
    select: { bucketType: true, blockedUntil: true },
  });

  // Account-dimension is checked first only for a deterministic, stable
  // choice of which dimension to report when both happen to be blocked —
  // it carries no security meaning (both dimensions are enforced either
  // way).
  const blockedAccount = rows.find((r) => r.bucketType === "ACCOUNT" && r.blockedUntil && r.blockedUntil > now);
  const blockedNetwork = rows.find((r) => r.bucketType === "NETWORK" && r.blockedUntil && r.blockedUntil > now);
  const blocked = blockedAccount ?? blockedNetwork;
  if (!blocked || !blocked.blockedUntil) return { blocked: false };

  return {
    blocked: true,
    dimension: blocked.bucketType as RateLimitDimension,
    retryAfterSeconds: secondsUntil(blocked.blockedUntil, now),
  };
}

async function incrementBucket(
  bucketType: RateLimitDimension,
  bucketKey: string,
  now: Date,
  windowCutoff: Date
): Promise<{ failureCount: number; alreadyBlocked: boolean }> {
  // Single atomic upsert: Postgres takes a row lock on the conflicting
  // unique-index entry before applying the UPDATE, so this is race-safe
  // under real concurrency without an application-level transaction or
  // advisory lock. If the existing row's window has expired, this also
  // resets the counter and clears any (necessarily also expired)
  // blockedUntil in the same statement.
  const rows = await prisma.$queryRaw<{ failureCount: number; blockedUntil: Date | null }[]>`
    INSERT INTO "LoginAttempt" ("id", "bucketType", "bucketKey", "failureCount", "windowStart", "blockedUntil", "updatedAt")
    VALUES (${randomUUID()}, ${bucketType}, ${bucketKey}, 1, ${now}, NULL, ${now})
    ON CONFLICT ("bucketType", "bucketKey") DO UPDATE SET
      "failureCount" = CASE WHEN "LoginAttempt"."windowStart" < ${windowCutoff} THEN 1 ELSE "LoginAttempt"."failureCount" + 1 END,
      "windowStart"  = CASE WHEN "LoginAttempt"."windowStart" < ${windowCutoff} THEN ${now} ELSE "LoginAttempt"."windowStart" END,
      "blockedUntil" = CASE WHEN "LoginAttempt"."windowStart" < ${windowCutoff} THEN NULL ELSE "LoginAttempt"."blockedUntil" END,
      "updatedAt"    = ${now}
    RETURNING "failureCount", "blockedUntil"
  `;
  const row = rows[0];
  return { failureCount: row.failureCount, alreadyBlocked: row.blockedUntil !== null && row.blockedUntil > now };
}

async function applyBlockIfThresholdReached(
  bucketType: RateLimitDimension,
  bucketKey: string,
  failureCount: number,
  now: Date,
  blockUntil: Date
): Promise<boolean> {
  if (failureCount < MAX_FAILED_ATTEMPTS) return false;
  // Idempotent under concurrency: only takes effect if no block is
  // currently set, so two transactions crossing the threshold at once
  // don't stomp on each other or extend the cooldown twice.
  const { count } = await prisma.loginAttempt.updateMany({
    where: { bucketType, bucketKey, blockedUntil: null },
    data: { blockedUntil: blockUntil, updatedAt: now },
  });
  return count > 0 || failureCount >= MAX_FAILED_ATTEMPTS;
}

/**
 * Records a failed login attempt against both dimensions and returns
 * whether either dimension is now blocked. Must only be called for a
 * genuine credential attempt (a well-formed email+password that was
 * actually checked against the database) — never for a validation
 * failure that never reached that point.
 */
export async function recordLoginFailure(keys: RateLimitKeys): Promise<RateLimitCheckResult> {
  const now = new Date();
  const windowCutoff = new Date(now.getTime() - WINDOW_MS);
  const blockUntil = new Date(now.getTime() + COOLDOWN_MS);

  const [network, account] = await Promise.all([
    incrementBucket("NETWORK", keys.networkBucketKey, now, windowCutoff),
    incrementBucket("ACCOUNT", keys.accountBucketKey, now, windowCutoff),
  ]);

  const [networkNowBlocked, accountNowBlocked] = await Promise.all([
    network.alreadyBlocked || applyBlockIfThresholdReached("NETWORK", keys.networkBucketKey, network.failureCount, now, blockUntil),
    account.alreadyBlocked || applyBlockIfThresholdReached("ACCOUNT", keys.accountBucketKey, account.failureCount, now, blockUntil),
  ]);

  if (accountNowBlocked) {
    return { blocked: true, dimension: "ACCOUNT", retryAfterSeconds: Math.ceil(COOLDOWN_MS / 1000) };
  }
  if (networkNowBlocked) {
    return { blocked: true, dimension: "NETWORK", retryAfterSeconds: Math.ceil(COOLDOWN_MS / 1000) };
  }
  return { blocked: false };
}

/** Called on a successful login — clears only the account-specific failure state, per policy (never the network bucket, and never a permanent lock). */
export async function clearAccountLoginRateLimit(accountBucketKey: string): Promise<void> {
  await prisma.loginAttempt.deleteMany({ where: { bucketType: "ACCOUNT", bucketKey: accountBucketKey } });
}
