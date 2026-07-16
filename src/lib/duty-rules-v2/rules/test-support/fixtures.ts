// TEST-ONLY fixtures for the Phase 5 rule-engine suites. Synthetic and
// city-independent; no production module imports this file.

import type { ConfiguredRuleDefinition } from "../domain/rule-definition";
import type { RuleEvaluationContext } from "../domain/rule-evaluation";
import type { SlotCandidate } from "../../engine/resolve-candidates";
import type { ResolvedSlot } from "../../engine/resolve-slots";

export function makeDefinition(
  overrides: Partial<ConfiguredRuleDefinition> & { ruleType: string }
): ConfiguredRuleDefinition {
  return {
    id: `rule-${overrides.ruleType.toLowerCase()}`,
    name: "Test Kuralı",
    enabled: true,
    severity: "HARD",
    priority: 100,
    scope: {},
    parameters: {},
    validFrom: null,
    validTo: null,
    exceptions: {},
    source: "ORGANIZATION_CONFIGURED",
    version: 1,
    metadata: {},
    ...overrides,
  };
}

export function makeSlot(overrides: Partial<ResolvedSlot> = {}): ResolvedSlot {
  return {
    slotKey: "2026-08-03:WEEKDAY:Tam Gün:0",
    date: "2026-08-03",
    dayTypeKey: "WEEKDAY",
    dayTypeRuleId: "dtr-WEEKDAY",
    slotId: "slot-WEEKDAY",
    slotName: null,
    shiftId: "shift-1",
    shiftKey: "Tam Gün",
    requiredCount: 1,
    poolId: "pool-1",
    sortOrder: 0,
    resolvable: true,
    ...overrides,
  };
}

export function makeCandidate(overrides: Partial<SlotCandidate> = {}): SlotCandidate {
  return {
    candidateKey: "2026-08-03:WEEKDAY:Tam Gün:0#m-a",
    slotKey: "2026-08-03:WEEKDAY:Tam Gün:0",
    date: "2026-08-03",
    poolId: "pool-1",
    membershipId: "m-a",
    pharmacyId: "ph-a",
    pharmacyName: "Çınar Eczanesi",
    pharmacyIsActive: true,
    sortIndex: null,
    membershipExclusion: null,
    unavailableOnDate: false,
    blockingRequestType: null,
    prefersThisDate: false,
    assignedToThisSlot: false,
    assignedSameDayElsewhere: false,
    historicalDutyCount: 0,
    historicalWeightedLoad: 0,
    historicalWeekendCount: 0,
    balanceAdjustment: 0,
    periodAssignments: [],
    lastDutyDate: null,
    daysSinceLastDuty: null,
    ...overrides,
  };
}

export function makeContext(
  overrides: Partial<RuleEvaluationContext> = {}
): RuleEvaluationContext {
  const slot = overrides.slot ?? makeSlot();
  return {
    organizationId: "org-1",
    regionId: "region-1",
    planId: "plan-1",
    planVersionId: "pv-1",
    generationMode: "PREVIEW",
    periodStart: "2026-08-01",
    periodEnd: "2026-08-31",
    date: slot.date,
    weekday: "MONDAY",
    holidayTypes: ["NONE"],
    holidayDates: new Set<string>(),
    dayType: "WEEKDAY",
    customDayCategory: null,
    dayTypeKey: slot.dayTypeKey,
    slot,
    poolId: slot.poolId,
    shiftKey: slot.shiftKey,
    shiftStartMinute: null,
    shiftEndMinute: null,
    candidate: makeCandidate(),
    fairness: null,
    rotation: null,
    tags: null,
    groups: null,
    serviceAreas: null,
    ...overrides,
  };
}
