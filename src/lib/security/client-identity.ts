import { isIP } from "node:net";
import { headers } from "next/headers";

import { hashIdentifier } from "./hash-identifier";

// Determines a "network bucket" identity for login rate limiting, without
// ever trusting a client-supplied forwarding header by default.
//
// AUDIT FINDING (see docs/security/21-login-rate-limit-proxy-validation.md
// and docs/testing/LOGIN_RATE_LIMIT_PROXY_TEST.md): this repository
// contains no code anywhere that reads x-forwarded-for, x-real-ip,
// forwarded, cf-connecting-ip, or NextRequest.ip — no client-IP header is
// trusted or even inspected today, and there is no railway.json/
// nixpacks.toml/Dockerfile in this repo that would prove which header (if
// any) Railway's edge sets, overwrites, or sanitizes before the request
// reaches this Node process. Because that cannot be proven from the
// repository, this helper defaults to NOT trusting any forwarding header
// at all, and requires an explicit opt-in (TRUST_PROXY_HEADERS=true) that
// must only ever be flipped on after the live verification steps in
// docs/testing/LOGIN_RATE_LIMIT_PROXY_TEST.md have been run against the
// actual deployed environment.
//
// When trust is not enabled (the default), every request is folded into
// one shared, non-identifying "untrusted network" bucket — this still
// lets the account-dimension of the rate limiter work correctly (see
// src/lib/auth/login-rate-limit.ts), it just cannot additionally
// throttle by distinct attacker network the way a verified per-IP bucket
// could.

const TRUSTED_FORWARD_HEADER = "x-forwarded-for";
const MAX_HEADER_LENGTH = 512;

export type ClientIdentity = {
  /** Always a SHA-256 digest — never a raw IP address. Safe to store/log. */
  networkBucketKey: string;
  /** True only when derived from a validated, explicitly-trusted proxy header. */
  trusted: boolean;
};

// Exported so tests (in particular the real-Postgres integration suite,
// which shares this fixed bucket row across every request made with
// trusted-proxy mode off) can explicitly clean it up between test cases.
export const UNTRUSTED_NETWORK_BUCKET_KEY = hashIdentifier("untrusted-network-bucket");

export function isTrustProxyHeadersEnabled(): boolean {
  return process.env.TRUST_PROXY_HEADERS === "true";
}

// Strips a trailing ":port" from what looks like an "ipv4:port" pair, and
// unwraps a bracketed IPv6 literal ("[::1]:443" -> "::1"). Never touches a
// bare IPv6 address (which itself contains multiple colons) since that
// would corrupt it — only single-colon values are treated as "host:port".
function stripPort(value: string): string {
  if (value.startsWith("[")) {
    const end = value.indexOf("]");
    return end === -1 ? value : value.slice(1, end);
  }
  const colonCount = (value.match(/:/g) ?? []).length;
  if (colonCount === 1) {
    return value.split(":")[0];
  }
  return value;
}

/** Validates and normalizes one candidate address. Returns null if not a valid IPv4/IPv6 literal. */
export function normalizeClientIp(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > 128) return null;
  const candidate = stripPort(trimmed);
  const version = isIP(candidate);
  if (version === 0) return null;
  return version === 6 ? candidate.toLowerCase() : candidate;
}

// Only the LAST entry in a comma-separated X-Forwarded-For chain is ever
// treated as proxy-appended — every earlier entry can be freely set by
// the client itself before the request reaches any proxy, so trusting
// anything but the final hop would let an attacker spoof their own
// bucket. This "trust only the last hop" rule is the conservative
// industry-standard default; whether Railway appends exactly one hop (as
// assumed here) or something else must be confirmed live — see
// docs/testing/LOGIN_RATE_LIMIT_PROXY_TEST.md, section A.
function extractTrustedCandidate(headerValue: string): string | null {
  if (headerValue.length > MAX_HEADER_LENGTH) return null;
  const parts = headerValue.split(",");
  const last = parts[parts.length - 1];
  return last ? normalizeClientIp(last) : null;
}

export async function getClientIdentity(): Promise<ClientIdentity> {
  if (!isTrustProxyHeadersEnabled()) {
    return { networkBucketKey: UNTRUSTED_NETWORK_BUCKET_KEY, trusted: false };
  }

  try {
    const headerList = await headers();
    const raw = headerList.get(TRUSTED_FORWARD_HEADER);
    if (!raw) {
      return { networkBucketKey: UNTRUSTED_NETWORK_BUCKET_KEY, trusted: false };
    }
    const candidate = extractTrustedCandidate(raw);
    if (!candidate) {
      return { networkBucketKey: UNTRUSTED_NETWORK_BUCKET_KEY, trusted: false };
    }
    return { networkBucketKey: hashIdentifier(candidate), trusted: true };
  } catch {
    return { networkBucketKey: UNTRUSTED_NETWORK_BUCKET_KEY, trusted: false };
  }
}
