import type { BrowserContext } from "@playwright/test";

import { SESSION_COOKIE_NAME } from "./fixtures";

/** Injects a real, DB-backed session token as the app's session cookie, without going through the login form. */
export async function addSessionCookie(
  context: BrowserContext,
  token: string,
  baseURL: string
): Promise<void> {
  const url = new URL(baseURL);
  await context.addCookies([
    {
      name: SESSION_COOKIE_NAME,
      value: token,
      domain: url.hostname,
      path: "/",
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);
}
