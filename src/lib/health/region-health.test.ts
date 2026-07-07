import { describe, expect, it } from "vitest";

import { evaluateRegionHealth } from "./region-health";

const BASE = {
  name: "Kadıköy",
  isActive: true,
  dailyDutyCount: 2,
  activePharmacyCount: 10,
  hasDutyRule: true,
};

describe("evaluateRegionHealth", () => {
  it("returns no issues for a healthy region", () => {
    expect(evaluateRegionHealth(BASE)).toEqual([]);
  });

  it("returns critical error when active pharmacies are fewer than daily duty count", () => {
    const issues = evaluateRegionHealth({ ...BASE, activePharmacyCount: 1 });
    expect(issues).toHaveLength(1);
    expect(issues[0].severity).toBe("CRITICAL");
    expect(issues[0].message).toContain("günlük nöbetçi ihtiyacından");
  });

  it("returns critical errors for missing duty rule and zero pharmacies", () => {
    const issues = evaluateRegionHealth({
      ...BASE,
      hasDutyRule: false,
      activePharmacyCount: 0,
    });
    expect(issues.map((i) => i.severity)).toEqual(["CRITICAL", "CRITICAL"]);
    expect(issues[0].message).toContain("nöbet kuralı tanımlanmamış");
    expect(issues[1].message).toContain("aktif eczane bulunmuyor");
  });

  it("warns when pharmacy pool is small but sufficient", () => {
    const issues = evaluateRegionHealth({ ...BASE, activePharmacyCount: 4 });
    expect(issues).toHaveLength(1);
    expect(issues[0].severity).toBe("WARNING");
  });

  it("skips inactive regions", () => {
    expect(
      evaluateRegionHealth({ ...BASE, isActive: false, hasDutyRule: false })
    ).toEqual([]);
  });
});
