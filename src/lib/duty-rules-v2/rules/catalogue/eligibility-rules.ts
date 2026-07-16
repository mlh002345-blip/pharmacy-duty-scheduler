// Duty Rules V2 — Phase 5 catalogue: hard eligibility rule types.
//
// These reproduce, as configurable catalogue entries, the safety rules
// every scheduling run needs. All are platform evaluators over candidate
// facts — chambers select and scope them, never implement them.

import { z } from "zod";

import { safeIdArray } from "../domain/rule-parameters";
import type { EvaluatorVerdict, RuleCatalogueEntry } from "../domain/rule-catalogue";
import type { RuleEvaluationContext } from "../domain/rule-evaluation";

const CANDIDATE_SCOPES = [
  "organizationId",
  "regionId",
  "planId",
  "planVersionId",
  "poolIds",
  "dayTypes",
  "customDayCategories",
  "shiftKeys",
  "slotIds",
  "pharmacyIds",
  "dateRange",
  "weekdays",
  "holidayTypes",
  "generationModes",
] as const;

const CANDIDATE_EXCEPTIONS = [
  "excludedDates",
  "includedDates",
  "excludedWeekdays",
  "excludedHolidayTypes",
  "excludedPharmacyIds",
  "excludedPoolIds",
  "excludedSlotIds",
  "excludedGenerationModes",
] as const;

function requireCandidate(
  context: RuleEvaluationContext,
  verdict: (candidate: NonNullable<RuleEvaluationContext["candidate"]>) => EvaluatorVerdict
): EvaluatorVerdict {
  if (context.candidate === null) {
    return {
      outcome: "NOT_APPLICABLE",
      observedValue: "slot-level",
      expectedValue: "candidate",
      explanationCode: "CANDIDATE_CONTEXT_REQUIRED",
      factsUsed: [],
    };
  }
  return verdict(context.candidate);
}

const noParameters = z.object({}).strict();

export const PHARMACY_MUST_BE_ACTIVE: RuleCatalogueEntry = {
  ruleType: "PHARMACY_MUST_BE_ACTIVE",
  evaluatorVersion: 1,
  allowedSeverities: ["HARD"],
  severityConfigurable: false,
  parameterSchema: noParameters,
  supportedScopeDimensions: CANDIDATE_SCOPES,
  supportedExceptionKinds: [], // A safety rule: no exceptions.
  requiredFacts: ["candidate.membershipExclusion"],
  participatesIn: ["ELIGIBILITY"],
  perCandidate: true,
  relaxable: false,
  relaxationMode: null,
  evaluate: (_parameters, context) =>
    requireCandidate(context, (candidate) => ({
      outcome: candidate.membershipExclusion === "PHARMACY_INACTIVE" ? "FAIL" : "PASS",
      observedValue: candidate.membershipExclusion === "PHARMACY_INACTIVE" ? "inactive" : "active",
      expectedValue: "active",
      explanationCode: "RULE_PHARMACY_INACTIVE",
      factsUsed: ["candidate.membershipExclusion"],
    })),
};

export const MEMBER_OF_POOL_AS_OF_DATE: RuleCatalogueEntry = {
  ruleType: "MEMBER_OF_POOL_AS_OF_DATE",
  evaluatorVersion: 1,
  allowedSeverities: ["HARD"],
  severityConfigurable: false,
  parameterSchema: noParameters,
  supportedScopeDimensions: CANDIDATE_SCOPES,
  supportedExceptionKinds: [],
  requiredFacts: ["candidate.membershipExclusion"],
  participatesIn: ["ELIGIBILITY"],
  perCandidate: true,
  relaxable: false,
  relaxationMode: null,
  evaluate: (_parameters, context) =>
    requireCandidate(context, (candidate) => ({
      outcome: candidate.membershipExclusion === "NOT_A_MEMBER" ? "FAIL" : "PASS",
      observedValue: candidate.membershipExclusion === "NOT_A_MEMBER" ? "not-member" : "member",
      expectedValue: "member",
      explanationCode: "RULE_NOT_A_MEMBER",
      factsUsed: ["candidate.membershipExclusion"],
    })),
};

export const PHARMACY_UNAVAILABLE_ON_DATE: RuleCatalogueEntry = {
  ruleType: "PHARMACY_UNAVAILABLE_ON_DATE",
  evaluatorVersion: 1,
  allowedSeverities: ["HARD"],
  severityConfigurable: false,
  parameterSchema: noParameters,
  supportedScopeDimensions: CANDIDATE_SCOPES,
  supportedExceptionKinds: [],
  requiredFacts: ["candidate.unavailableOnDate"],
  participatesIn: ["ELIGIBILITY"],
  perCandidate: true,
  relaxable: false,
  relaxationMode: null,
  evaluate: (_parameters, context) =>
    requireCandidate(context, (candidate) => ({
      outcome: candidate.unavailableOnDate ? "FAIL" : "PASS",
      observedValue: candidate.unavailableOnDate ? "unavailable" : "available",
      expectedValue: "available",
      explanationCode: "RULE_UNAVAILABLE",
      factsUsed: ["candidate.unavailableOnDate"],
    })),
};

export const BLOCK_APPROVED_CANNOT_DUTY_REQUEST: RuleCatalogueEntry = {
  ruleType: "BLOCK_APPROVED_CANNOT_DUTY_REQUEST",
  evaluatorVersion: 1,
  allowedSeverities: ["HARD"],
  severityConfigurable: false,
  parameterSchema: noParameters,
  supportedScopeDimensions: CANDIDATE_SCOPES,
  supportedExceptionKinds: [],
  requiredFacts: ["candidate.blockingRequestType"],
  participatesIn: ["ELIGIBILITY"],
  perCandidate: true,
  relaxable: false,
  relaxationMode: null,
  evaluate: (_parameters, context) =>
    requireCandidate(context, (candidate) => ({
      outcome: candidate.blockingRequestType === "CANNOT_DUTY" ? "FAIL" : "PASS",
      observedValue: candidate.blockingRequestType ?? "none",
      expectedValue: "none",
      explanationCode: "RULE_CANNOT_DUTY_REQUEST",
      factsUsed: ["candidate.blockingRequestType"],
    })),
};

export const BLOCK_APPROVED_EMERGENCY_EXCUSE: RuleCatalogueEntry = {
  ruleType: "BLOCK_APPROVED_EMERGENCY_EXCUSE",
  evaluatorVersion: 1,
  allowedSeverities: ["HARD"],
  severityConfigurable: false,
  parameterSchema: noParameters,
  supportedScopeDimensions: CANDIDATE_SCOPES,
  supportedExceptionKinds: [],
  requiredFacts: ["candidate.blockingRequestType"],
  participatesIn: ["ELIGIBILITY"],
  perCandidate: true,
  relaxable: false,
  relaxationMode: null,
  evaluate: (_parameters, context) =>
    requireCandidate(context, (candidate) => ({
      outcome: candidate.blockingRequestType === "EMERGENCY_EXCUSE" ? "FAIL" : "PASS",
      observedValue: candidate.blockingRequestType ?? "none",
      expectedValue: "none",
      explanationCode: "RULE_EMERGENCY_EXCUSE",
      factsUsed: ["candidate.blockingRequestType"],
    })),
};

export const SAME_SLOT_DUPLICATE_FORBIDDEN: RuleCatalogueEntry = {
  ruleType: "SAME_SLOT_DUPLICATE_FORBIDDEN",
  evaluatorVersion: 1,
  allowedSeverities: ["HARD"],
  severityConfigurable: false,
  parameterSchema: noParameters,
  supportedScopeDimensions: CANDIDATE_SCOPES,
  supportedExceptionKinds: [],
  requiredFacts: ["candidate.assignedToThisSlot"],
  participatesIn: ["ELIGIBILITY"],
  perCandidate: true,
  relaxable: false,
  relaxationMode: null,
  evaluate: (_parameters, context) =>
    requireCandidate(context, (candidate) => ({
      outcome: candidate.assignedToThisSlot ? "FAIL" : "PASS",
      observedValue: candidate.assignedToThisSlot ? "assigned" : "unassigned",
      expectedValue: "unassigned",
      explanationCode: "RULE_DUPLICATE_SLOT_ASSIGNMENT",
      factsUsed: ["candidate.assignedToThisSlot"],
    })),
};

export const EXCLUDE_PHARMACY: RuleCatalogueEntry = {
  ruleType: "EXCLUDE_PHARMACY",
  evaluatorVersion: 1,
  allowedSeverities: ["HARD", "SOFT", "ADVISORY"],
  severityConfigurable: true,
  parameterSchema: z.object({ pharmacyIds: safeIdArray.refine((ids) => ids.length > 0) }).strict(),
  supportedScopeDimensions: CANDIDATE_SCOPES,
  supportedExceptionKinds: CANDIDATE_EXCEPTIONS,
  requiredFacts: ["candidate.pharmacyId"],
  participatesIn: ["ELIGIBILITY"],
  perCandidate: true,
  relaxable: false,
  relaxationMode: null,
  evaluate: (parameters, context) =>
    requireCandidate(context, (candidate) => {
      const { pharmacyIds } = parameters as { pharmacyIds: string[] };
      const excluded = pharmacyIds.includes(candidate.pharmacyId);
      return {
        outcome: excluded ? "FAIL" : "PASS",
        observedValue: excluded ? "listed" : "not-listed",
        expectedValue: "not-listed",
        explanationCode: "RULE_PHARMACY_EXPLICITLY_EXCLUDED",
        factsUsed: ["candidate.pharmacyId"],
      };
    }),
};

export const INCLUDE_ONLY_PHARMACIES: RuleCatalogueEntry = {
  ruleType: "INCLUDE_ONLY_PHARMACIES",
  evaluatorVersion: 1,
  allowedSeverities: ["HARD", "SOFT"],
  severityConfigurable: true,
  parameterSchema: z.object({ pharmacyIds: safeIdArray.refine((ids) => ids.length > 0) }).strict(),
  supportedScopeDimensions: CANDIDATE_SCOPES,
  supportedExceptionKinds: CANDIDATE_EXCEPTIONS,
  requiredFacts: ["candidate.pharmacyId"],
  participatesIn: ["ELIGIBILITY"],
  perCandidate: true,
  relaxable: false,
  relaxationMode: null,
  evaluate: (parameters, context) =>
    requireCandidate(context, (candidate) => {
      const { pharmacyIds } = parameters as { pharmacyIds: string[] };
      const included = pharmacyIds.includes(candidate.pharmacyId);
      return {
        outcome: included ? "PASS" : "FAIL",
        observedValue: included ? "listed" : "not-listed",
        expectedValue: "listed",
        explanationCode: "RULE_PHARMACY_NOT_IN_INCLUDE_LIST",
        factsUsed: ["candidate.pharmacyId"],
      };
    }),
};
