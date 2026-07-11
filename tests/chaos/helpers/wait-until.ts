// Deterministic polling gate — never a blind `await sleep(N)` as the
// correctness mechanism. Polls `check()` on a short bounded interval
// until it returns true or `timeoutMs` elapses, then throws with the
// last-seen state so a failing scenario reports *why* the condition
// never became true instead of a bare timeout.

export async function waitUntil(
  check: () => boolean | Promise<boolean>,
  options: { timeoutMs: number; pollIntervalMs?: number; description: string }
): Promise<number> {
  const pollIntervalMs = options.pollIntervalMs ?? 50;
  const start = Date.now();
  for (;;) {
    if (await check()) return Date.now() - start;
    if (Date.now() - start >= options.timeoutMs) {
      throw new Error(
        `waitUntil timed out after ${options.timeoutMs}ms waiting for: ${options.description}`
      );
    }
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }
}
