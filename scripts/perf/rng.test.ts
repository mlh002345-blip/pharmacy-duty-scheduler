import { describe, expect, it } from "vitest";

import { createRng, pick, randomInt } from "./rng";

describe("createRng", () => {
  it("produces the exact same sequence for the same seed", () => {
    const a = createRng(42);
    const b = createRng(42);
    const seqA = Array.from({ length: 20 }, () => a());
    const seqB = Array.from({ length: 20 }, () => b());
    expect(seqA).toEqual(seqB);
  });

  it("produces a different sequence for a different seed", () => {
    const a = createRng(1);
    const b = createRng(2);
    const seqA = Array.from({ length: 10 }, () => a());
    const seqB = Array.from({ length: 10 }, () => b());
    expect(seqA).not.toEqual(seqB);
  });

  it("always returns values in [0, 1)", () => {
    const rng = createRng(7);
    for (let i = 0; i < 1_000; i++) {
      const v = rng();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe("randomInt", () => {
  it("stays within [min, max] inclusive and is deterministic for a fixed seed", () => {
    const rng = createRng(99);
    const values = Array.from({ length: 500 }, () => randomInt(rng, 5, 10));
    for (const v of values) {
      expect(v).toBeGreaterThanOrEqual(5);
      expect(v).toBeLessThanOrEqual(10);
    }

    const rngA = createRng(123);
    const rngB = createRng(123);
    const seqA = Array.from({ length: 20 }, () => randomInt(rngA, 0, 1000));
    const seqB = Array.from({ length: 20 }, () => randomInt(rngB, 0, 1000));
    expect(seqA).toEqual(seqB);
  });
});

describe("pick", () => {
  it("always returns an element from the provided array", () => {
    const rng = createRng(5);
    const items = ["a", "b", "c"];
    for (let i = 0; i < 100; i++) {
      expect(items).toContain(pick(rng, items));
    }
  });

  it("is deterministic for a fixed seed", () => {
    const items = ["x", "y", "z", "w"];
    const rngA = createRng(55);
    const rngB = createRng(55);
    const seqA = Array.from({ length: 15 }, () => pick(rngA, items));
    const seqB = Array.from({ length: 15 }, () => pick(rngB, items));
    expect(seqA).toEqual(seqB);
  });
});
