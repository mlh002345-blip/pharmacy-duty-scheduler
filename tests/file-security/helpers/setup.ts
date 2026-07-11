import { vi } from "vitest";

// Evaluating this module first (before mutating process.env.DATABASE_URL
// below) caches the already-guard-validated URL as a plain string
// constant — see tests/chaos/helpers/setup.ts's comment for why this
// ordering matters (a second guard call after the mutation would see
// FILE_TEST_DATABASE_URL === the now-overwritten DATABASE_URL and
// incorrectly reject itself).
import { fileTestDatabaseUrl } from "./db";
import "../../../scripts/file-security/db";

process.env.DATABASE_URL = fileTestDatabaseUrl;

// Mirrors tests/integration/helpers/setup.ts / tests/chaos/helpers/setup.ts
// — the minimum seam needed to call real Server Actions
// (historicalImportAction) outside Next's request lifecycle.
type CookieValue = { value: string } | undefined;
const cookieState = { token: undefined as string | undefined };

export function setFileTestSessionToken(token: string | undefined): void {
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

export class FileTestRedirectSignal extends Error {
  constructor(public path: string) {
    super(`REDIRECT:${path}`);
  }
}

vi.mock("next/navigation", () => ({
  redirect: (path: string) => {
    throw new FileTestRedirectSignal(path);
  },
}));

vi.mock("next/cache", () => ({
  revalidatePath: () => {},
}));
