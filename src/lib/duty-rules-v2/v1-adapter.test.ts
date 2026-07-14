import { describe, expect, it } from "vitest";

import {
  V1_ADAPTER_VERSION,
  V1_DAY_TYPES,
  V1AdapterError,
  adaptV1RuleToV2Config,
  canonicalSerialize,
  projectAdaptedConfigToV1,
  validateAdaptedConfig,
  type V1AdapterInput,
} from "./v1-adapter";

function makeInput(overrides: Partial<V1AdapterInput> = {}): V1AdapterInput {
  return {
    organizationId: "org-1",
    region: { id: "region-1", organizationId: "org-1", name: "Birinci Bölge", dailyDutyCount: 2 },
    dutyRule: {
      id: "rule-1",
      regionId: "region-1",
      minDaysBetweenDuties: 3,
      weekdayWeight: 1,
      saturdayWeight: 1.25,
      sundayWeight: 1.5,
      officialHolidayWeight: 2,
      religiousHolidayWeight: 2.5,
    },
    pharmacies: [
      { id: "ph-b", name: "Şifa Eczanesi", isActive: true, regionId: "region-1" },
      { id: "ph-a", name: "Çınar Eczanesi", isActive: true, regionId: "region-1" },
      { id: "ph-c", name: "Kapalı Eczanesi", isActive: false, regionId: "region-1" },
    ],
    ...overrides,
  };
}

describe("adaptV1RuleToV2Config — field-by-field mapping", () => {
  it("maps dailyDutyCount to every slot's requiredCount exactly (including > 1)", () => {
    const config = adaptV1RuleToV2Config(makeInput());
    expect(config.slotRequirements).toHaveLength(6);
    expect(config.slotRequirements.every((s) => s.requiredCount === 2)).toBe(true);

    const single = adaptV1RuleToV2Config(
      makeInput({ region: { ...makeInput().region, dailyDutyCount: 1 } })
    );
    expect(single.slotRequirements.every((s) => s.requiredCount === 1)).toBe(true);
  });

  it("maps every V1 weight to its day type exactly, with OTHER holidays recorded as official-weighted", () => {
    const config = adaptV1RuleToV2Config(makeInput());
    const byType = new Map(config.dayTypeRules.map((r) => [r.dayType, r]));
    expect(byType.get("WEEKDAY")).toMatchObject({ weight: 1, distinctInV1: true });
    expect(byType.get("SATURDAY")).toMatchObject({ weight: 1.25, distinctInV1: true });
    expect(byType.get("SUNDAY")).toMatchObject({ weight: 1.5, distinctInV1: true });
    expect(byType.get("OFFICIAL_HOLIDAY")).toMatchObject({ weight: 2, distinctInV1: true });
    expect(byType.get("RELIGIOUS_HOLIDAY")).toMatchObject({ weight: 2.5, distinctInV1: true });
    expect(config.compatibility.otherHolidayWeightSource).toBe("OFFICIAL_HOLIDAY");
  });

  it("does not invent a holiday-eve distinction V1 does not have", () => {
    const config = adaptV1RuleToV2Config(makeInput());
    const eve = config.dayTypeRules.find((r) => r.dayType === "HOLIDAY_EVE");
    expect(eve).toMatchObject({ served: true, distinctInV1: false, weight: null });
  });

  it("maps the minimum interval and records V1's relaxation and tie-break semantics", () => {
    const config = adaptV1RuleToV2Config(makeInput());
    expect(config.fairness.minDaysBetweenDuties).toBe(3);
    expect(config.fairness.relaxMinIntervalWhenInsufficient).toBe(true);
    expect(config.fairness.openingBalanceIncluded).toBe(true);
    expect(config.fairness.tieBreakers[0]).toBe("TOTAL_LOAD_SCORE");
    expect(config.fairness.tieBreakers.at(-1)).toBe("NAME_TR_LOCALE");
  });

  it("pool membership = active in-region pharmacies (sorted); inactive ones are excluded, never dropped", () => {
    const config = adaptV1RuleToV2Config(makeInput());
    expect(config.rotationPool.memberships.map((m) => m.pharmacyId)).toEqual(["ph-a", "ph-b"]);
    expect(config.rotationPool.excluded).toEqual([{ pharmacyId: "ph-c", reason: "INACTIVE" }]);
    // Nothing silently dropped: memberships + excluded = every input pharmacy.
    expect(config.rotationPool.memberships.length + config.rotationPool.excluded.length).toBe(3);
  });

  it("represents the single V1 shift with null time semantics (V1 has none)", () => {
    const config = adaptV1RuleToV2Config(makeInput());
    expect(config.shift).toMatchObject({ startMinute: null, endMinute: null, spansMidnight: null });
  });

  it("covers all six built-in day types, all served", () => {
    const config = adaptV1RuleToV2Config(makeInput());
    expect(config.dayTypeRules.map((r) => r.dayType).sort()).toEqual([...V1_DAY_TYPES].sort());
    expect(config.dayTypeRules.every((r) => r.served)).toBe(true);
    expect(validateAdaptedConfig(config)).toEqual([]);
  });

  it("carries the compatibility metadata (source, ids, adapter version) with no timestamp", () => {
    const config = adaptV1RuleToV2Config(makeInput());
    expect(config.compatibility).toMatchObject({
      mode: true,
      source: "V1_DUTY_RULE",
      sourceRuleId: "rule-1",
      sourceRegionId: "region-1",
      organizationId: "org-1",
    });
    expect(config.adapterVersion).toBe(V1_ADAPTER_VERSION);
    expect(canonicalSerialize(config)).not.toMatch(/20\d\d-\d\d-\d\dT/); // no timestamps anywhere
  });
});

describe("synthetic identifiers and determinism", () => {
  it("derives stable keys from region/rule ids only", () => {
    const config = adaptV1RuleToV2Config(makeInput());
    expect(config.plan.key).toBe("v1-plan:region-1");
    expect(config.version.key).toBe(`v1-version:rule-1:v${V1_ADAPTER_VERSION}`);
    expect(config.shift.key).toBe("v1-shift:region-1");
    expect(config.rotationPool.key).toBe("v1-pool:region-1");
    expect(config.slotRequirements.map((s) => s.key)).toEqual(
      V1_DAY_TYPES.map((d) => `v1-slot:${d}:0`)
    );
  });

  it("produces byte-identical canonical output across three runs and any input ordering", () => {
    const base = makeInput();
    const shuffled = makeInput({
      pharmacies: [...base.pharmacies].reverse(),
    });
    const outputs = [
      canonicalSerialize(adaptV1RuleToV2Config(base)),
      canonicalSerialize(adaptV1RuleToV2Config(shuffled)),
      canonicalSerialize(adaptV1RuleToV2Config(makeInput())),
    ];
    expect(outputs[0]).toBe(outputs[1]);
    expect(outputs[1]).toBe(outputs[2]);
  });

  it("two organizations with identical region/rule NAMES still produce non-colliding keys", () => {
    const a = adaptV1RuleToV2Config(makeInput());
    const b = adaptV1RuleToV2Config(
      makeInput({
        organizationId: "org-2",
        region: { id: "region-9", organizationId: "org-2", name: "Birinci Bölge", dailyDutyCount: 2 },
        dutyRule: { ...makeInput().dutyRule, id: "rule-9", regionId: "region-9" },
        pharmacies: [{ id: "ph-z", name: "Şifa Eczanesi", isActive: true, regionId: "region-9" }],
      })
    );
    expect(a.plan.name).toBe(b.plan.name); // same human name is fine
    expect(a.plan.key).not.toBe(b.plan.key);
    expect(a.rotationPool.key).not.toBe(b.rotationPool.key);
  });
});

describe("validation and controlled errors", () => {
  it("rejects a region belonging to another organization", () => {
    expect(() =>
      adaptV1RuleToV2Config(
        makeInput({ region: { ...makeInput().region, organizationId: "org-OTHER" } })
      )
    ).toThrowError(
      expect.objectContaining({ code: "ORGANIZATION_REGION_MISMATCH" }) as unknown as Error
    );
  });

  it("rejects a duty rule belonging to another region", () => {
    expect(() =>
      adaptV1RuleToV2Config(
        makeInput({ dutyRule: { ...makeInput().dutyRule, regionId: "region-OTHER" } })
      )
    ).toThrowError(expect.objectContaining({ code: "RULE_REGION_MISMATCH" }) as unknown as Error);
  });

  it("rejects a pharmacy from another region, without leaking its name", () => {
    try {
      adaptV1RuleToV2Config(
        makeInput({
          pharmacies: [
            { id: "ph-x", name: "Gizli Eczanesi", isActive: true, regionId: "region-OTHER" },
          ],
        })
      );
      expect.unreachable("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(V1AdapterError);
      expect((error as V1AdapterError).code).toBe("PHARMACY_REGION_MISMATCH");
      expect((error as Error).message).not.toContain("Gizli");
    }
  });

  it("rejects duplicate pharmacies", () => {
    const p = { id: "ph-a", name: "A", isActive: true, regionId: "region-1" };
    expect(() => adaptV1RuleToV2Config(makeInput({ pharmacies: [p, { ...p }] }))).toThrowError(
      expect.objectContaining({ code: "DUPLICATE_PHARMACY" }) as unknown as Error
    );
  });

  it("rejects requiredCount below 1, non-positive weights, and negative intervals", () => {
    expect(() =>
      adaptV1RuleToV2Config(makeInput({ region: { ...makeInput().region, dailyDutyCount: 0 } }))
    ).toThrowError(expect.objectContaining({ code: "INVALID_REQUIRED_COUNT" }) as unknown as Error);
    expect(() =>
      adaptV1RuleToV2Config(makeInput({ dutyRule: { ...makeInput().dutyRule, sundayWeight: 0 } }))
    ).toThrowError(expect.objectContaining({ code: "INVALID_WEIGHT" }) as unknown as Error);
    expect(() =>
      adaptV1RuleToV2Config(
        makeInput({ dutyRule: { ...makeInput().dutyRule, minDaysBetweenDuties: -1 } })
      )
    ).toThrowError(expect.objectContaining({ code: "INVALID_MIN_INTERVAL" }) as unknown as Error);
  });

  it("validateAdaptedConfig catches tampered outputs (duplicate keys, unknown refs, missing day types)", () => {
    const config = adaptV1RuleToV2Config(makeInput());
    const tampered = structuredClone(config);
    tampered.slotRequirements[0].poolKey = "v1-pool:BAŞKA";
    tampered.slotRequirements[1].shiftKey = "v1-shift:BAŞKA";
    tampered.slotRequirements[2].requiredCount = 0;
    tampered.dayTypeRules = tampered.dayTypeRules.filter((r) => r.dayType !== "SUNDAY");
    tampered.rotationPool.memberships.push({ ...tampered.rotationPool.memberships[0] });
    const codes = validateAdaptedConfig(tampered).map((i) => i.code).sort();
    expect(codes).toEqual(
      ["DUPLICATE_MEMBERSHIP", "INVALID_REQUIRED_COUNT", "MISSING_DAY_TYPE", "UNKNOWN_POOL", "UNKNOWN_SHIFT"].sort()
    );
  });
});

describe("reverse projection", () => {
  it("reconstructs the exact V1 rule/count/pharmacy configuration", () => {
    const input = makeInput();
    const reconstructed = projectAdaptedConfigToV1(adaptV1RuleToV2Config(input));
    expect(reconstructed.regionId).toBe("region-1");
    expect(reconstructed.dailyDutyCount).toBe(2);
    expect(reconstructed.dutyRule).toEqual({
      minDaysBetweenDuties: 3,
      weekdayWeight: 1,
      saturdayWeight: 1.25,
      sundayWeight: 1.5,
      officialHolidayWeight: 2,
      religiousHolidayWeight: 2.5,
    });
    expect(reconstructed.pharmacies.map((p) => p.id)).toEqual(["ph-a", "ph-b"]);
    expect(reconstructed.pharmacies.every((p) => p.isActive && p.regionId === "region-1")).toBe(true);
  });
});
