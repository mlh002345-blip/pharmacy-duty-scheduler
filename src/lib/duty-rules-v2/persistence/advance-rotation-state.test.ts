import { describe, expect, it } from "vitest";

import {
  computeRotationAdvancement,
  dayTypeKeyFromSlotKey,
  pickRotationStateScope,
} from "./advance-rotation-state";

describe("dayTypeKeyFromSlotKey", () => {
  it("extracts the dayTypeKey segment from a well-formed slotKey", () => {
    expect(dayTypeKeyFromSlotKey("2026-09-01:WEEKDAY:shift-1:0")).toBe("WEEKDAY");
  });

  it("returns null for a malformed slotKey with fewer than 2 segments", () => {
    expect(dayTypeKeyFromSlotKey("2026-09-01")).toBeNull();
  });
});

describe("pickRotationStateScope", () => {
  const states = [
    { dayTypeScope: "ALL", id: "s-all" },
    { dayTypeScope: "SATURDAY", id: "s-sat" },
  ];

  it("prefers an exact dayTypeScope match over ALL", () => {
    expect(pickRotationStateScope(states, "SATURDAY")).toEqual({ dayTypeScope: "SATURDAY", id: "s-sat" });
  });

  it("falls back to ALL when no exact match exists", () => {
    expect(pickRotationStateScope(states, "SUNDAY")).toEqual({ dayTypeScope: "ALL", id: "s-all" });
  });

  it("returns null when neither an exact match nor ALL exists", () => {
    expect(pickRotationStateScope([{ dayTypeScope: "SATURDAY", id: "s-sat" }], "SUNDAY")).toBeNull();
  });
});

describe("computeRotationAdvancement", () => {
  const active = ["m-a", "m-b", "m-c"];

  it("sets lastServedMembershipId to the last served membership, no prior cursor: zero rounds consumed", () => {
    const result = computeRotationAdvancement({
      currentRound: 0,
      lastServedMembershipId: null,
      carriedForward: [],
      servedMembershipIdsInOrder: ["m-a"],
      activeMembershipIdsInOrder: active,
    });
    expect(result).toEqual({ currentRound: 0, lastServedMembershipId: "m-a", carriedForward: [] });
  });

  it("advances one full round exactly once the batch completes a full pass through the pool", () => {
    // cursor starts at m-a; serving b, c, a again is exactly one full lap.
    const result = computeRotationAdvancement({
      currentRound: 2,
      lastServedMembershipId: "m-a",
      carriedForward: [],
      servedMembershipIdsInOrder: ["m-b", "m-c", "m-a"],
      activeMembershipIdsInOrder: active,
    });
    expect(result.currentRound).toBe(3);
    expect(result.lastServedMembershipId).toBe("m-a");
  });

  it("does not advance currentRound for a partial pass (fewer steps than pool size)", () => {
    const result = computeRotationAdvancement({
      currentRound: 5,
      lastServedMembershipId: "m-a",
      carriedForward: [],
      servedMembershipIdsInOrder: ["m-b"],
      activeMembershipIdsInOrder: active,
    });
    expect(result.currentRound).toBe(5);
    expect(result.lastServedMembershipId).toBe("m-b");
  });

  it("wraps distance to the full pool size when the very same membership is served again immediately (distance 0 -> size)", () => {
    const result = computeRotationAdvancement({
      currentRound: 0,
      lastServedMembershipId: "m-a",
      carriedForward: [],
      servedMembershipIdsInOrder: ["m-a"],
      activeMembershipIdsInOrder: active,
    });
    // one full lap consumed (0 wraps to size=3), so exactly one round.
    expect(result.currentRound).toBe(1);
    expect(result.lastServedMembershipId).toBe("m-a");
  });

  it("accumulates distance across a batch spanning more than one full round", () => {
    // m-a -> m-b (1) -> m-c (1) -> m-a (1) -> m-b (1) = 4 steps over size 3 = 1 full round, remainder 1.
    const result = computeRotationAdvancement({
      currentRound: 0,
      lastServedMembershipId: "m-a",
      carriedForward: [],
      servedMembershipIdsInOrder: ["m-b", "m-c", "m-a", "m-b"],
      activeMembershipIdsInOrder: active,
    });
    expect(result.currentRound).toBe(1);
    expect(result.lastServedMembershipId).toBe("m-b");
  });

  it("a served membership no longer active still becomes the cursor but contributes zero distance", () => {
    const result = computeRotationAdvancement({
      currentRound: 1,
      lastServedMembershipId: "m-a",
      carriedForward: [],
      servedMembershipIdsInOrder: ["m-left-pool"],
      activeMembershipIdsInOrder: active,
    });
    expect(result.currentRound).toBe(1);
    expect(result.lastServedMembershipId).toBe("m-left-pool");
  });

  it("clears a carriedForward entry for a membership that was actually served in this batch", () => {
    const result = computeRotationAdvancement({
      currentRound: 0,
      lastServedMembershipId: "m-a",
      carriedForward: [
        { membershipId: "m-b", reason: "SKIPPED", periodKey: "2026-08" },
        { membershipId: "m-c", reason: "UNAVAILABLE", periodKey: "2026-08" },
      ],
      servedMembershipIdsInOrder: ["m-b"],
      activeMembershipIdsInOrder: active,
    });
    expect(result.carriedForward).toEqual([{ membershipId: "m-c", reason: "UNAVAILABLE", periodKey: "2026-08" }]);
  });

  it("never invents a new carriedForward entry for a membership not previously owed one", () => {
    const result = computeRotationAdvancement({
      currentRound: 0,
      lastServedMembershipId: "m-a",
      carriedForward: [],
      servedMembershipIdsInOrder: ["m-b", "m-c"],
      activeMembershipIdsInOrder: active,
    });
    expect(result.carriedForward).toEqual([]);
  });

  it("is deterministic: identical input always produces identical output", () => {
    const input = {
      currentRound: 4,
      lastServedMembershipId: "m-b",
      carriedForward: [{ membershipId: "m-a", reason: "SKIPPED" as const, periodKey: "2026-08" }],
      servedMembershipIdsInOrder: ["m-c", "m-a", "m-b", "m-c"],
      activeMembershipIdsInOrder: active,
    };
    expect(computeRotationAdvancement(input)).toEqual(computeRotationAdvancement(input));
  });

  it("handles an empty served list as a true no-op", () => {
    const result = computeRotationAdvancement({
      currentRound: 3,
      lastServedMembershipId: "m-a",
      carriedForward: [{ membershipId: "m-b", reason: "SKIPPED", periodKey: "2026-08" }],
      servedMembershipIdsInOrder: [],
      activeMembershipIdsInOrder: active,
    });
    expect(result).toEqual({
      currentRound: 3,
      lastServedMembershipId: "m-a",
      carriedForward: [{ membershipId: "m-b", reason: "SKIPPED", periodKey: "2026-08" }],
    });
  });
});
