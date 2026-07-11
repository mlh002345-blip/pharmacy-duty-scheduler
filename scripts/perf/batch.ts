// Pure chunking helper used by seed-perf-data.ts's batched createMany
// calls — never a tight create() loop for large row counts. Split out so
// the batching boundary logic itself is directly unit-testable.

export function chunk<T>(items: T[], size: number): T[][] {
  if (size <= 0) throw new Error("chunk() size must be positive");
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}
