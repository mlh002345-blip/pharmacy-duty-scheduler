// Shared between src/middleware.ts and its tests. An incoming client-
// supplied x-request-id is only trusted if it matches this conservative
// format — alphanumeric plus hyphen/underscore, 8-128 characters (covers
// a standard UUID and most common ID schemes) — otherwise a fresh
// crypto.randomUUID() is generated instead. This bounds the header to a
// safe length/charset before it's ever echoed back in a response header
// or embedded in a log line.
export const REQUEST_ID_HEADER = "x-request-id";
export const SAFE_REQUEST_ID_PATTERN = /^[A-Za-z0-9_-]{8,128}$/;

export function isSafeRequestId(value: string | null | undefined): value is string {
  return typeof value === "string" && SAFE_REQUEST_ID_PATTERN.test(value);
}
