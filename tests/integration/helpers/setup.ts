import { vi } from "vitest";

import { pointProcessAtTestDatabase } from "./test-db-guard";

// Runs inside every worker process before its test files are imported —
// re-applies the same fail-fast safety check as global-setup.ts (which
// runs in a separate process and doesn't share process.env with workers)
// and points this worker's DATABASE_URL at the test database before
// anything imports src/lib/prisma.ts.
pointProcessAtTestDatabase();

// The three Next.js runtime APIs that only exist inside an actual HTTP
// request/render (cookies()/headers() from "next/headers", redirect() from
// "next/navigation", revalidatePath() from "next/cache") are stubbed here
// — and ONLY here. Every other module (Prisma, business logic,
// transactions, validation, dedup-key computation, logging) is the real,
// unmodified application code running against the real test database.
// This is the minimum seam needed to call the actual exported Server
// Actions outside of Next's request lifecycle; see
// docs/security/19-test-gap-assertion-quality.md for the full rationale.

type CookieValue = { value: string } | undefined;

const cookieState = { token: undefined as string | undefined };

export function setIntegrationTestSessionToken(token: string | undefined): void {
  cookieState.token = token;
}

const fakeCookieStore = {
  get(name: string): CookieValue {
    if (name !== "session_token") return undefined;
    return cookieState.token ? { value: cookieState.token } : undefined;
  },
  set(): void {
    // No real browser/response to attach a Set-Cookie header to — tests
    // authenticate by creating a real Session row and calling
    // setIntegrationTestSessionToken() directly instead of relying on
    // createSession()'s cookie side effect.
  },
  delete(): void {
    cookieState.token = undefined;
  },
};

vi.mock("next/headers", () => ({
  cookies: async () => fakeCookieStore,
  headers: async () => new Headers(),
}));

export class IntegrationRedirectSignal extends Error {
  constructor(public path: string) {
    super(`REDIRECT:${path}`);
  }
}

vi.mock("next/navigation", () => ({
  redirect: (path: string) => {
    throw new IntegrationRedirectSignal(path);
  },
}));

vi.mock("next/cache", () => ({
  revalidatePath: () => {
    // No real render cache to invalidate outside a request — a no-op here
    // is behaviorally identical to production from the caller's
    // perspective, which never inspects revalidatePath's return value.
  },
}));
