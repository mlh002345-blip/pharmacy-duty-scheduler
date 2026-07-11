// Pure percentile/statistics helpers for benchmark measurements. No I/O,
// no randomness — directly unit-testable.

export type DurationStats = {
  count: number;
  min: number;
  max: number;
  p50: number;
  p95: number;
  p99: number | null; // null when there are too few samples for a meaningful p99
  mean: number;
};

/** Nearest-rank percentile over a sorted-ascending copy of `values`. */
export function percentile(values: number[], p: number): number {
  if (values.length === 0) throw new Error("percentile() requires at least one value");
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil((p / 100) * sorted.length);
  const index = Math.min(Math.max(rank - 1, 0), sorted.length - 1);
  return sorted[index];
}

// p99 is only meaningful with a reasonable sample size — with fewer than
// this many samples, the "99th percentile" is just the max, which is
// already reported separately and would be misleading to double-count as
// a distinct, meaningful p99.
const MIN_SAMPLES_FOR_P99 = 20;

export function computeDurationStats(values: number[]): DurationStats {
  if (values.length === 0) throw new Error("computeDurationStats() requires at least one value");
  const sorted = [...values].sort((a, b) => a - b);
  const sum = sorted.reduce((acc, v) => acc + v, 0);
  return {
    count: sorted.length,
    min: sorted[0],
    max: sorted[sorted.length - 1],
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    p99: sorted.length >= MIN_SAMPLES_FOR_P99 ? percentile(sorted, 99) : null,
    mean: sum / sorted.length,
  };
}

export type RegressionComparison = {
  metric: string;
  before: number;
  after: number;
  deltaMs: number;
  deltaPercent: number;
  verdict: "improvement" | "regression" | "no-change";
};

// A change smaller than this is treated as noise, not a real
// improvement/regression — local benchmark timing has natural jitter.
const NOISE_THRESHOLD_PERCENT = 10;

export function compareDurations(metric: string, before: number, after: number): RegressionComparison {
  const deltaMs = after - before;
  const deltaPercent = before === 0 ? 0 : (deltaMs / before) * 100;
  let verdict: RegressionComparison["verdict"] = "no-change";
  if (deltaPercent > NOISE_THRESHOLD_PERCENT) verdict = "regression";
  else if (deltaPercent < -NOISE_THRESHOLD_PERCENT) verdict = "improvement";
  return { metric, before, after, deltaMs, deltaPercent, verdict };
}
