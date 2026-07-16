// TEST-ONLY fixture factories for the engine-domain suites. No
// production module imports this file; it lives under test-support/ so
// the three engine test files share one synthetic, city-independent
// fixture universe instead of three drifting copies.

import type { LoadedDutyPlanVersion } from "../../domain/loaded-plan";
import type { DutyEngineInput } from "../domain/engine-input";

export const DAY_TYPES = [
  "WEEKDAY",
  "SATURDAY",
  "SUNDAY",
  "OFFICIAL_HOLIDAY",
  "RELIGIOUS_HOLIDAY",
  "HOLIDAY_EVE",
] as const;

export function makeLoadedPlan(
  mutate?: (plan: LoadedDutyPlanVersion) => void
): LoadedDutyPlanVersion {
  const plan: LoadedDutyPlanVersion = {
    loaderVersion: 1,
    organizationId: "org-1",
    regionId: "region-1",
    planId: "plan-1",
    planName: "Merkez Planı",
    planVersionId: "pv-1",
    versionNumber: 1,
    status: "ACTIVE",
    validFrom: "2026-01-01",
    validTo: null,
    configurationFingerprint: "cfg-fingerprint-test",
    dayTypeRules: DAY_TYPES.map((dayType) => ({
      id: `dtr-${dayType}`,
      dayType,
      isServed: true,
      customDayCategory: null,
    })),
    shiftDefinitions: [
      {
        id: "shift-1",
        name: "Tam Gün",
        startMinute: 0,
        endMinute: 0,
        spansMidnight: false,
        defaultWeight: 1,
        sortOrder: 0,
      },
    ],
    slotRequirements: DAY_TYPES.map((dayType) => ({
      id: `slot-${dayType}`,
      name: null,
      requiredCount: 1,
      sortOrder: 0,
      dayTypeRuleId: `dtr-${dayType}`,
      shiftDefinitionId: "shift-1",
      rotationPoolId: "pool-1",
    })),
    rotationPools: [
      {
        id: "pool-1",
        name: "Merkez Havuzu",
        strategy: "FAIRNESS_SCORE",
        regionId: "region-1",
        memberships: [
          {
            id: "m-a",
            pharmacyId: "ph-a",
            pharmacyName: "Çınar Eczanesi",
            pharmacyIsActive: true,
            joinedOn: "2026-01-01",
            leftOn: null,
            sortIndex: null,
          },
          {
            id: "m-b",
            pharmacyId: "ph-b",
            pharmacyName: "Işık Eczanesi",
            pharmacyIsActive: true,
            joinedOn: "2026-01-01",
            leftOn: null,
            sortIndex: null,
          },
          {
            id: "m-c",
            pharmacyId: "ph-c",
            pharmacyName: "Öz Deva Eczanesi",
            pharmacyIsActive: true,
            joinedOn: "2026-01-01",
            leftOn: null,
            sortIndex: null,
          },
        ],
        rotationStates: [
          {
            id: "rs-1",
            dayTypeScope: "ALL",
            currentRound: 1,
            lockVersion: 0,
            carriedForward: [],
            lastServedMembershipId: "m-a",
          },
        ],
      },
    ],
    membershipSnapshots: null,
    diagnostics: [],
  };
  mutate?.(plan);
  return plan;
}

export function makeEngineInput(
  plan: LoadedDutyPlanVersion,
  overrides: Partial<Omit<DutyEngineInput, "loadedPlan">> = {}
): DutyEngineInput {
  return {
    loadedPlan: plan,
    organizationId: plan.organizationId,
    regionId: plan.regionId,
    periodStart: "2026-08-03", // Monday
    periodEnd: "2026-08-09", // Sunday
    generationMode: "PREVIEW",
    policy: {
      minDaysBetweenDuties: 2,
      relaxMinIntervalWhenInsufficient: true,
      dayTypeWeights: [
        { dayTypeKey: "WEEKDAY", weight: 1 },
        { dayTypeKey: "SATURDAY", weight: 1.25 },
        { dayTypeKey: "SUNDAY", weight: 1.5 },
        { dayTypeKey: "OFFICIAL_HOLIDAY", weight: 2 },
        { dayTypeKey: "RELIGIOUS_HOLIDAY", weight: 2.5 },
        { dayTypeKey: "HOLIDAY_EVE", weight: 1 },
      ],
      sameDaySecondAssignmentAllowed: false,
    },
    holidays: [],
    customDayOverrides: [],
    unavailability: [],
    dutyRequests: [],
    historicalDuties: [],
    balanceAdjustments: [],
    existingAssignments: [],
    ...overrides,
  };
}
