// Starts/stops a real production server (`next start`, against the
// build produced once by global-setup.ts) bound to a dedicated port,
// pointed at CHAOS_DATABASE_URL. Used by HTTP-level scenarios that need
// to observe real framework-level error handling (no stack trace/SQL/
// connection string reaching the response body) — something a direct
// function call bypasses entirely.

import { ChildProcess, spawn } from "node:child_process";

import { chaosDatabaseUrl } from "./db";

export const CHAOS_SERVER_PORT = 3212;
export const CHAOS_BASE_URL = `http://localhost:${CHAOS_SERVER_PORT}`;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForServer(url: string, timeoutMs: number): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(2_000) });
      if (res.status < 500) return;
    } catch {
      // not up yet
    }
    await sleep(300);
  }
  throw new Error(`Chaos server at ${url} did not become ready within ${timeoutMs}ms`);
}

export type ChaosServerHandle = {
  proc: ChildProcess;
  /** Everything the server process has written to stdout/stderr so far — used to assert on structured log lines (see src/lib/observability/logger.ts). */
  getOutput: () => string;
  clearOutput: () => void;
};

export async function startChaosServer(): Promise<ChaosServerHandle> {
  // `detached: true` puts this process in its own process group so
  // stopChaosServer can kill the *entire* group (npx -> node -> the
  // actual next-server it execs) — a plain SIGTERM to just the npx
  // wrapper process was observed to leave the real next-server child
  // running and holding the port after the test that started it exited.
  const proc = spawn("npx", ["next", "start", "-p", String(CHAOS_SERVER_PORT)], {
    env: { ...process.env, DATABASE_URL: chaosDatabaseUrl, NODE_ENV: "production" },
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  });
  let output = "";
  proc.stdout?.on("data", (chunk: Buffer) => {
    output += chunk.toString("utf-8");
  });
  proc.stderr?.on("data", (chunk: Buffer) => {
    output += chunk.toString("utf-8");
  });
  await waitForServer(CHAOS_BASE_URL, 30_000);
  return {
    proc,
    getOutput: () => output,
    clearOutput: () => {
      output = "";
    },
  };
}

export async function stopChaosServer(handle: ChaosServerHandle): Promise<void> {
  const pid = handle.proc.pid;
  try {
    if (pid) process.kill(-pid, "SIGTERM"); // negative pid = whole process group
  } catch {
    handle.proc.kill("SIGTERM");
  }
  await sleep(500);
  try {
    if (pid) process.kill(-pid, "SIGKILL");
  } catch {
    // already gone
  }
}
