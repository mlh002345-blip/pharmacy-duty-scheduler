// Next.js server instrumentation hook (stable since Next 15) — the
// standard seam for observing errors that reach Next's own built-in
// error boundary before any log line is emitted for them.
//
// WHY THIS EXISTS: Step 6 (DB resilience/chaos testing,
// docs/security/24-db-resilience-connection-pool-validation.md) found
// that when PostgreSQL is unreachable during a page render (e.g. `/`
// calling prisma.pharmacy.count()), the user-facing response was already
// safe (Next's production error boundary strips the real error and
// serves only a generic page + opaque digest — no stack trace, SQL, or
// connection string ever reached the browser) but the failure was never
// logged anywhere via this app's structured logger
// (src/lib/observability/logger.ts) — an operator would have no
// diagnosable record of *why* users were seeing errors during an outage.
// This hook closes that gap without changing any page's code or the
// response the user sees.
//
// Only registered for the Node.js runtime (the app has no Edge routes
// that touch Prisma) and only imports the heavier logger/Prisma-error
// types lazily inside the function, per Next's own guidance for
// instrumentation.ts (importing at module top-level would pull them into
// the Edge bundle too, when Next evaluates this file for both runtimes).
export async function register() {
  // No setup needed — onRequestError below is the only hook used.
}

export async function onRequestError(
  error: unknown,
  request: { path: string; method: string; headers: Record<string, string | string[] | undefined> },
  context: { routerKind: string; routeType: string; renderSource?: string }
) {
  if (process.env.NEXT_RUNTIME === "edge") return; // defensive — this app has no Edge routes

  const { logger } = await import("@/lib/observability/logger");
  const { isSafeRequestId } = await import("@/lib/observability/request-id-format");
  const { Prisma } = await import("@prisma/client");

  const isDatabaseError =
    error instanceof Prisma.PrismaClientKnownRequestError ||
    error instanceof Prisma.PrismaClientUnknownRequestError ||
    error instanceof Prisma.PrismaClientInitializationError ||
    error instanceof Prisma.PrismaClientRustPanicError;

  const rawRequestId = request.headers["x-request-id"];
  const candidateRequestId = typeof rawRequestId === "string" ? rawRequestId : undefined;
  const requestId = isSafeRequestId(candidateRequestId) ? candidateRequestId : undefined;

  // Two specific, operationally distinct Prisma/PostgreSQL error codes
  // get their own event name — both empirically confirmed against a real
  // PostgreSQL instance in Step 6's chaos suite (see
  // docs/security/24-db-resilience-connection-pool-validation.md,
  // scenarios D and E) — because they call for different operator
  // responses than a generic connectivity failure: P2024 means the
  // connection pool itself is undersized/overloaded (a capacity
  // question), while a raw 55P03 (wrapped by Prisma as P2010) means a
  // statement was waiting on a row/advisory lock past its configured
  // lock_timeout (a contention question). Everything else database-
  // shaped falls back to the existing read/request-failure events.
  const prismaCode = error instanceof Prisma.PrismaClientKnownRequestError ? error.code : undefined;
  const pgCode =
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.meta &&
    typeof error.meta === "object" &&
    "code" in error.meta
      ? String((error.meta as { code?: unknown }).code)
      : undefined;

  // "render" = a Server Component failed while producing a page (the
  // read paths this scenario is about); anything else (a Server Action
  // or Route Handler) already has its own explicit try/catch and
  // controlled-failure logging at the call site — see
  // src/app/**/actions.ts and export route handlers — so this hook only
  // adds a *fallback* log for the render case that previously had none.
  const event =
    prismaCode === "P2024"
      ? "database_pool_timeout"
      : pgCode === "55P03"
        ? "database_lock_timeout"
        : isDatabaseError && context.renderSource
          ? "database_read_failed"
          : isDatabaseError
            ? "database_request_failed"
            : "unhandled_request_error";

  logger.error(
    event,
    {
      requestId,
      routeType: context.routeType,
      path: request.path,
      method: typeof request.method === "string" ? request.method : undefined,
    },
    error
  );
}
