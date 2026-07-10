// A deferred-promise barrier for forcing two async operations to begin
// their real work at (as close as JS allows to) the same instant, instead
// of relying on arbitrary sleeps. Both callbacks are invoked immediately
// (so any synchronous setup inside them runs right away), but each awaits
// `gate` as its very first statement — so by the time `release()` is
// called (synchronously, right after both have been invoked and are
// therefore already suspended at their `await gate`), both resume and
// issue their real database calls back-to-back in the same microtask
// tick, giving Postgres two genuinely overlapping writes to race.
export function createGate(): { gate: Promise<void>; release: () => void } {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { gate, release };
}

export async function raceThroughGate<T1, T2>(
  first: () => Promise<T1>,
  second: () => Promise<T2>
): Promise<[PromiseSettledResult<T1>, PromiseSettledResult<T2>]> {
  const { gate, release } = createGate();

  const p1 = (async () => {
    await gate;
    return first();
  })();
  const p2 = (async () => {
    await gate;
    return second();
  })();

  // Both async IIFEs above have already synchronously run up to their
  // `await gate` by this point (nothing async precedes it), so release()
  // here truly lets them resume together.
  release();

  return Promise.allSettled([p1, p2]);
}
