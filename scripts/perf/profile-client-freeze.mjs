// Client-freeze profiling harness — SPA-navigation soak (25 cycles x 4 pages) with emulated visibility flips.
// Usage (against a production build):
//   npm run build && PORT=3399 npm run start &
//   node scripts/perf/profile-client-freeze.mjs
// Adjust BASE/credentials for other targets. Reports long tasks, DOM/
// head/script counts, JS heap, request counts, and navigation timings.
// Written for the "Sayfa Yanıt Vermiyor" investigation — see
// docs/testing/TAB_FOCUS_FREEZE_INVESTIGATION.md.
import { chromium } from "@playwright/test";

const BASE = "http://localhost:3399";

const INIT = `
  window.__prof = { listeners: {}, timeouts: 0, intervals: 0, rafs: 0, longTasks: [], errors: [] };
  const origAdd = EventTarget.prototype.addEventListener;
  EventTarget.prototype.addEventListener = function (type, ...rest) {
    window.__prof.listeners[type] = (window.__prof.listeners[type] || 0) + 1;
    return origAdd.call(this, type, ...rest);
  };
  const origRemove = EventTarget.prototype.removeEventListener;
  EventTarget.prototype.removeEventListener = function (type, ...rest) {
    window.__prof.listeners[type] = (window.__prof.listeners[type] || 0) - 1;
    return origRemove.call(this, type, ...rest);
  };
  const origST = window.setTimeout; window.setTimeout = (...a) => { window.__prof.timeouts++; return origST(...a); };
  const origSI = window.setInterval; window.setInterval = (...a) => { window.__prof.intervals++; return origSI(...a); };
  const origRaf = window.requestAnimationFrame; window.requestAnimationFrame = (...a) => { window.__prof.rafs++; return origRaf(...a); };
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) window.__prof.longTasks.push({ start: e.startTime, dur: e.duration });
    }).observe({ entryTypes: ["longtask"] });
  } catch {}
  window.addEventListener("error", (e) => window.__prof.errors.push(String(e.message)));
`;

async function snap(page, label) {
  const data = await page.evaluate(() => ({
    listeners: Object.fromEntries(Object.entries(window.__prof.listeners).filter(([, v]) => v > 0)),
    timeouts: window.__prof.timeouts,
    intervals: window.__prof.intervals,
    rafs: window.__prof.rafs,
    longTasks: window.__prof.longTasks.length,
    longTaskTotalMs: window.__prof.longTasks.reduce((s, t) => s + t.dur, 0),
    maxLongTaskMs: Math.max(0, ...window.__prof.longTasks.map((t) => t.dur)),
    errors: window.__prof.errors,
    heapMB: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null,
  }));
  console.log(`--- ${label} ---`);
  console.log(JSON.stringify(data));
  return data;
}

async function setVisibility(page, hidden) {
  const session = await page.context().newCDPSession(page);
  await session.send("Emulation.setFocusEmulationEnabled", { enabled: !hidden });
  await page.evaluate((h) => {
    Object.defineProperty(document, "visibilityState", { value: h ? "hidden" : "visible", configurable: true });
    Object.defineProperty(document, "hidden", { value: h, configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
    window.dispatchEvent(new Event(h ? "blur" : "focus"));
  }, hidden);
  await session.detach();
}

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const context = await browser.newContext();
const page = await context.newPage();
await page.addInitScript(INIT);

let requestCount = 0;
const requestsByPath = {};
page.on("request", (r) => {
  requestCount++;
  const u = new URL(r.url());
  const key = `${r.method()} ${u.pathname}`;
  requestsByPath[key] = (requestsByPath[key] || 0) + 1;
});

// Login through the real form.
await page.goto(`${BASE}/giris`);
await page.fill('input[name="email"]', "admin@example.com");
await page.fill('input[name="password"]', "Admin123!");
await page.click('button[type="submit"]');
await page.waitForURL(`${BASE}/`);
await snap(page, "after login");
const reqAfterLogin = requestCount;

const lifecycle = await page.context().newCDPSession(page);
const navLinks = [
  ["Panel", "/"],
  ["Eczaneler", "/eczaneler"],
  ["Nöbet Bölgeleri", "/bolgeler"],
  ["Nöbet Kuralları", "/kurallar"],
];
const navTimes = [];
for (let cycle = 1; cycle <= 25; cycle++) {
  // Realistic background-tab lifecycle: freeze, wait, resume.
  await lifecycle.send("Page.setWebLifecycleState", { state: "frozen" });
  await new Promise((r) => setTimeout(r, 500));
  await lifecycle.send("Page.setWebLifecycleState", { state: "active" });
  await setVisibility(page, false);
  await page.waitForTimeout(200);
  for (const [label, path] of navLinks) {
    const t0 = Date.now();
    await page.click(`aside >> text="${label}"`, { timeout: 20000 });
    await page.waitForURL((u) => u.pathname === path, { timeout: 20000 });
    await page.waitForLoadState("networkidle", { timeout: 20000 }).catch(() => {});
    const navMs = Date.now() - t0;
    navTimes.push(navMs);
    if (navMs > 3000) console.log(`SLOW NAV cycle ${cycle} ${label}: ${navMs}ms`);
  }
  const dom = await page.evaluate(() => ({
    nodes: document.getElementsByTagName("*").length,
    head: document.head.children.length,
    scripts: document.scripts.length,
    links: document.querySelectorAll("link").length,
    styles: document.querySelectorAll("style").length,
  }));
  console.log(`cycle ${cycle}: dom=${JSON.stringify(dom)} avgNavMs=${Math.round(navTimes.slice(-4).reduce((a,b)=>a+b,0)/4)} heap=${await page.evaluate(() => performance.memory ? Math.round(performance.memory.usedJSHeapSize/1048576) : null)}MB requests=${requestCount}`);
  if (cycle === 25) {
    const s = await snap(page, `after cycle ${cycle}`);
    if (s.errors.length) console.log("BROWSER ERRORS:", s.errors);
  }
}
console.log("nav times ms:", JSON.stringify(navTimes));
console.log("request delta over 10 cycles:", requestCount - reqAfterLogin);
console.log("top request paths:", JSON.stringify(Object.entries(requestsByPath).sort((a, b) => b[1] - a[1]).slice(0, 8)));
await browser.close();
