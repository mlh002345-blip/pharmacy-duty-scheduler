// Client-freeze profiling harness — real two-tab switching via bringToFront + 6x CPU throttling (10 cycles).
// Usage (against a production build):
//   npm run build && PORT=3399 npm run start &
//   node scripts/perf/profile-client-freeze-realistic.mjs
// Adjust BASE/credentials for other targets. Reports long tasks, DOM/
// head/script counts, JS heap, request counts, and navigation timings.
// Written for the "Sayfa Yanıt Vermiyor" investigation — see
// docs/testing/TAB_FOCUS_FREEZE_INVESTIGATION.md.
import { chromium } from "@playwright/test";

const BASE = "http://localhost:3399";
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const context = await browser.newContext();
const app = await context.newPage();
await app.addInitScript(`
  window.__lt = [];
  try {
    new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__lt.push(Math.round(e.duration)); })
      .observe({ entryTypes: ["longtask"] });
  } catch {}
`);
const other = await context.newPage();
await other.goto("about:blank");

const cdp = await context.newCDPSession(app);
await cdp.send("Emulation.setCPUThrottlingRate", { rate: 6 });

await app.bringToFront();
await app.goto(`${BASE}/giris`);
await app.fill('input[name="email"]', "admin@example.com");
await app.fill('input[name="password"]', "Admin123!");
await app.click('button[type="submit"]');
await app.waitForURL(`${BASE}/`);

const links = [
  ["Panel", "/"],
  ["Eczaneler", "/eczaneler"],
  ["Nöbet Bölgeleri", "/bolgeler"],
  ["Nöbet Kuralları", "/kurallar"],
];
for (let cycle = 1; cycle <= 10; cycle++) {
  await other.bringToFront();               // app tab actually hidden
  await other.waitForTimeout(400);
  await app.bringToFront();                 // real visibilitychange->visible
  const vis = await app.evaluate(() => document.visibilityState);
  await app.waitForTimeout(300);
  for (const [label, path] of links) {
    const t0 = Date.now();
    await app.click(`aside >> text="${label}"`);
    await app.waitForURL((u) => u.pathname === path, { timeout: 30000 });
    const ms = Date.now() - t0;
    if (ms > 3000) console.log(`SLOW cycle ${cycle} ${label}: ${ms}ms`);
  }
  const lt = await app.evaluate(() => { const v = [...window.__lt]; window.__lt.length = 0; return v; });
  console.log(`cycle ${cycle}: visibility=${vis} longTasks=[${lt.join(",")}]ms heap=${await app.evaluate(() => Math.round(performance.memory.usedJSHeapSize/1048576))}MB`);
}
await browser.close();
console.log("done");
