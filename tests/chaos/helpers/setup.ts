import { vi } from "vitest";

// Both of these modules resolve+validate CHAOS_DATABASE_URL (via the
// shared guard) at their own top-level import — evaluating them here,
// first, caches that validated URL as a plain string constant before
// `process.env.DATABASE_URL` is overwritten below. ES modules are
// evaluated exactly once per process and then cached, so every later
// import of either module (from fault-control.ts, spec files, etc.)
// reuses the already-resolved value instead of re-invoking the guard —
// which matters because a *second* guard call after the mutation below
// would see CHAOS_DATABASE_URL === (the now-overwritten) DATABASE_URL
// and incorrectly reject itself as "pointing at its own DATABASE_URL".
import { chaosDatabaseUrl } from "./db";
import "../../../scripts/chaos/db";

// Runs inside every worker process before its test files are imported —
// points this worker's DATABASE_URL at the chaos database before
// anything imports src/lib/prisma.ts, so real server actions/library
// functions called directly by a spec (not through a real HTTP request)
// use the app's own singleton Prisma client against the guarded chaos
// database. Mirrors tests/integration/helpers/setup.ts's
// pointProcessAtTestDatabase() — the direct assignment here (rather than
// calling pointProcessAtChaosDatabase(), which re-invokes the guard) is
// what avoids the self-equality problem described above.
process.env.DATABASE_URL = chaosDatabaseUrl;

type CookieValue = { value: string } | undefined;

const cookieState = { token: undefined as string | undefined };

export function setChaosTestSessionToken(token: string | undefined): void {
  cookieState.token = token;
}

const fakeCookieStore = {
  get(name: string): CookieValue {
    if (name !== "session_token") return undefined;
    return cookieState.token ? { value: cookieState.token } : undefined;
  },
  set(): void {},
  delete(): void {
    cookieState.token = undefined;
  },
};

vi.mock("next/headers", () => ({
  cookies: async () => fakeCookieStore,
  headers: async () => new Headers(),
}));

export class ChaosRedirectSignal extends Error {
  constructor(public path: string) {
    super(`REDIRECT:${path}`);
  }
}

vi.mock("next/navigation", () => ({
  redirect: (path: string) => {
    throw new ChaosRedirectSignal(path);
  },
}));

vi.mock("next/cache", () => ({
  revalidatePath: () => {},
}));
