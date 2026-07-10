import { headers } from "next/headers";

// src/middleware.ts stamps every request with an x-request-id header
// (either a validated incoming value or a freshly generated UUID) before
// it reaches any Server Component/Action/Route Handler. This helper reads
// it back out so log calls anywhere in the request can attach it, letting
// the same request's log lines (and, separately, the response header sent
// back to the client) be correlated after the fact — see
// docs/security/16-logging-observability-auditability.md.
//
// Returns undefined (never throws) if headers() is unavailable in the
// current context (e.g. called outside a request) so callers can always
// safely spread the result into a log context.
export async function getRequestId(): Promise<string | undefined> {
  try {
    const headerList = await headers();
    return headerList.get("x-request-id") ?? undefined;
  } catch {
    return undefined;
  }
}
