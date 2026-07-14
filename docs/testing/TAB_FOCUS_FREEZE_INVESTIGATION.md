# "Sayfa Yanıt Vermiyor" (Tab-Focus Freeze) Investigation

Branch `fix/tab-focus-main-thread-freeze`. Investigates the production
report: returning to the application's browser tab (and navigating
between authenticated pages) frequently shows Chrome's
"Sayfa Yanıt Vermiyor" (page unresponsive) dialog, with only 59
pharmacies and 11 regions.

## Verdict

**The application code cannot produce a visibility-triggered
main-thread freeze, and none could be reproduced against the production
build under any tested condition.** No application defect was found;
no speculative code change was made (the task's own rules forbid broad
speculative fixes). A permanent Playwright regression guard now pins
the healthy behavior, and two reusable profiling harnesses are included
for running the same measurements against the real production
deployment, where the remaining candidate causes live (see "What to do
next in production" below).

## Static evidence: no code reacts to tab visibility at all

Verified in **source** (`src/`) and independently in the **shipped
client bundles** (`.next/static/chunks/` of a fresh production build):

- Zero `visibilitychange` / `document.visibilityState` listeners —
  in app code **and** in every built chunk (grep of the compiled
  output; the only `pageshow`/`pagehide` handler is Next.js's own
  boolean bfcache flag, which does no work).
- Zero `window`-level `focus`/`blur` listeners (React's internal
  focus-restoration helper adds and removes symmetrically in the same
  call).
- Zero `setInterval`, zero `requestAnimationFrame`, zero polling, zero
  `router.refresh()`, zero `location.reload` anywhere in `src/`.
- Zero `useEffect` in any shared/layout client component: the only
  client components on authenticated pages are the sidebar (pure
  render, `usePathname` only), `SubmitButton` (`useFormStatus` only),
  and form components mounted on their own pages. The single
  `setTimeout` in the codebase (`export-button.tsx`) is cleared in a
  `finally` block.
- No session-refresh, online/offline, storage, or BroadcastChannel
  logic exists.

There is, structurally, nothing for a tab switch to trigger.

## Dynamic evidence: production-build profiling (all healthy)

All runs: `npm run build` + `npm run start` (NODE_ENV=production, CSP
and all security headers active), real Chromium, real login, dataset
matched to the report (11 regions, 100 pharmacies — more than the
reported 59). Harnesses: `scripts/perf/profile-client-freeze.mjs` and
`scripts/perf/profile-client-freeze-realistic.mjs`.

| Scenario | Result |
|---|---|
| 40 full page loads across `/`, `/eczaneler`, `/bolgeler`, `/kurallar` with emulated visibility flips | 0 long tasks, no listener/timer growth |
| 100 client-side (SPA) navigations over 25 hide/show cycles, incl. CDP `Page.setWebLifecycleState` freeze/resume | DOM flat (327 nodes, head 21, 25 scripts), heap flat (7–20 MB GC oscillation, no trend), nav times flat (avg 258 ms first cycle → 67–87 ms steady), requests bounded (~8/cycle, no growth) |
| 40 SPA navigations with **real two-tab switching** (`bringToFront`, genuine `visibilitychange`) under **6× CPU throttling** | Worst main-thread task 415 ms (initial hydration, once); steady state 50–130 ms; heap flat; zero slow navigations |
| Same soak repeated with per-request CSP nonce active | identical — no script/style accumulation in `<head>` |

Renders, requests, timers, listeners, DOM size, and heap are all flat
across every cycle. Chrome's "page unresponsive" dialog requires the
renderer main thread to be blocked for on the order of 10+ seconds; the
worst task ever observed here, under 6× throttling, was 0.415 s.

## Classification

Not a CPU loop, not a request loop, not a render loop, not a listener
leak, not a memory leak — **in this codebase**. The reported freeze is
therefore environment-side with high confidence. Leading candidates,
in likelihood order, all specific to the affected machine/browser:

1. **Chrome extensions that walk the DOM on tab focus** — translation
   extensions/Chrome's own translate feature (Turkish-language pages),
   password managers, and ad blockers re-scan the full document on
   `visibilitychange` and on SPA DOM swaps; this is a well-known cause
   of exactly this dialog. Test: does the freeze reproduce in a clean
   Chrome profile / guest window with extensions disabled?
2. **Client machine under memory pressure** (Chrome discarding/
   re-rasterizing tabs on return; GPU driver stalls on Windows).
3. **Something in front of the app** (an intercepting proxy/antivirus
   HTTPS scanner) delaying every response so the tab appears hung —
   distinguishable because the dialog would then NOT appear (slow
   network keeps the page responsive), which is worth confirming with
   the reporter: does the actual Chrome "Sayfa Yanıt Vermiyor" dialog
   box appear, or does the page merely load slowly?

## What to do next in production

1. Ask the affected user to reproduce in a clean profile
   (`chrome://extensions` all off, or a guest window). If it stops,
   it's an extension.
2. Capture a Performance trace on the affected machine: DevTools →
   Performance → record → switch tabs and return → stop. The long task
   attribution will name the culprit directly.
3. Run the included harnesses against the real production URL with a
   real account (adjust `BASE` and credentials):
   `node scripts/perf/profile-client-freeze-realistic.mjs`.
4. `chrome://crashes` and `chrome://memory-internals` on the affected
   machine for renderer OOM/hang records.

## Permanent regression guard

`tests/e2e/specs/tab-focus-responsiveness.spec.ts` — logs in, creates
an 11-region tenant, then runs 10 cycles of real tab hide/show
(`bringToFront` between two tabs, genuine `visibilitychange`) plus
4-page client-side navigation, asserting after every cycle:

- the main thread answers an `evaluate` within 2 s immediately after
  returning to the tab (the exact reported moment),
- every navigation completes within 10 s,
- per-cycle request counts stay bounded and do not trend upward
  (a future refresh/polling loop fails this),
- net focus/visibility-family listener registrations stay ≤ 5 and
  `setInterval` registrations ≤ 2 (a future accumulating listener or
  poller fails this),
- zero uncaught browser errors.

Run twice consecutively during this investigation, both green (11.7 s
and 43.5 s wall time). It runs as part of the ordinary
`npm run test:e2e` suite from now on.
