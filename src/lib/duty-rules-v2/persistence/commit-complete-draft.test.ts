// Duty Rules V2 — Phase 8: pure, DB-free unit tests for
// commit-complete-draft.ts's own gate logic (structural eligibility,
// fingerprint/manifest tampering, tenant mismatch). These never touch
// Postgres — every case tested here is rejected by validateDraftStructurally
// or validateTenant, BOTH of which run and return before this module
// makes its first database call. Reference-validation, atomic
// persistence, idempotency, conflicts, and rollback all require a real
// database and live in
// tests/integration/duty-rules-v2-atomic-draft-persistence.integration.test.ts.

import { describe, expect, it } from "vitest";

import { makeLoadedPlan, makeEngineInput } from "../engine/test-support/fixtures";
import { buildDutyEngineContext } from "../engine/build-engine-context";
import { buildCompatibilityRules } from "../rules/build-compatibility-rules";
import { buildV1CompatibilitySelectionStrategy } from "../selection/build-v1-compatibility-strategy";
import { commitCompleteDraft } from "./commit-complete-draft";
import type { CompleteDraftSchedule } from "../draft/domain/draft-schedule";

function buildValidDraft(): CompleteDraftSchedule {
  const plan = makeLoadedPlan();
  const input = makeEngineInput(plan, {
    configuredRules: buildCompatibilityRules(makeEngineInput(plan).policy),
    configuredSelectionStrategies: [
      buildV1CompatibilitySelectionStrategy({ organizationId: plan.organizationId, regionId: plan.regionId }),
    ],
  });
  const result = buildDutyEngineContext(input);
  expect(result.completeDraftSchedule.status).toBe("COMPLETE");
  expect(result.completeDraftSchedule.isCommitEligible).toBe(true);
  return result.completeDraftSchedule;
}

function buildPartialDraft(): CompleteDraftSchedule {
  const plan = makeLoadedPlan();
  const input = makeEngineInput(plan, {
    configuredRules: buildCompatibilityRules(makeEngineInput(plan).policy),
    configuredSelectionStrategies: [],
  });
  const result = buildDutyEngineContext(input);
  expect(result.completeDraftSchedule.status).toBe("PARTIAL");
  return result.completeDraftSchedule;
}

const ORG = "org-1";
const REGION = "region-1";
const USER = "user-1";

describe("commitCompleteDraft — structural eligibility gate", () => {
  it("does not reject a genuinely COMPLETE, commit-eligible draft at the structural gate", async () => {
    const draft = buildValidDraft();
    // Deliberately WRONG tenant so we stop just past the structural gate
    // (at validateTenant) without needing a database at all — proves the
    // structural checks themselves did not reject a valid draft.
    const result = await commitCompleteDraft({ draft, organizationId: "some-other-org", regionId: REGION, userId: USER });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("DRAFT_TENANT_MISMATCH");
  });

  it("rejects a PARTIAL draft with DRAFT_NOT_COMMIT_ELIGIBLE", async () => {
    const draft = buildPartialDraft();
    const result = await commitCompleteDraft({ draft, organizationId: ORG, regionId: REGION, userId: USER });
    expect(result).toEqual({
      ok: false,
      code: "DRAFT_NOT_COMMIT_ELIGIBLE",
      message: expect.any(String),
    });
  });

  it("rejects an INVALID-status draft with DRAFT_NOT_COMMIT_ELIGIBLE", async () => {
    const draft: CompleteDraftSchedule = { ...buildValidDraft(), status: "INVALID" };
    const result = await commitCompleteDraft({ draft, organizationId: ORG, regionId: REGION, userId: USER });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("DRAFT_NOT_COMMIT_ELIGIBLE");
  });

  it("rejects a draft with isCommitEligible=false with DRAFT_NOT_COMMIT_ELIGIBLE", async () => {
    const draft: CompleteDraftSchedule = { ...buildValidDraft(), isCommitEligible: false };
    const result = await commitCompleteDraft({ draft, organizationId: ORG, regionId: REGION, userId: USER });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("DRAFT_NOT_COMMIT_ELIGIBLE");
  });

  it("rejects a draft carrying a blocking diagnostic code with DRAFT_NOT_COMMIT_ELIGIBLE", async () => {
    const base = buildValidDraft();
    const draft: CompleteDraftSchedule = {
      ...base,
      manifest: { ...base.manifest, blockingDiagnosticCodes: ["DRAFT_ORIGIN_MISMATCH"] },
    };
    const result = await commitCompleteDraft({ draft, organizationId: ORG, regionId: REGION, userId: USER });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("DRAFT_NOT_COMMIT_ELIGIBLE");
  });

  it("rejects a tampered completeDraftFingerprint with DRAFT_FINGERPRINT_MISMATCH", async () => {
    const base = buildValidDraft();
    // Mutate a real content field WITHOUT recomputing the fingerprint —
    // simulates tampering/corruption between generation and commit.
    const draft: CompleteDraftSchedule = {
      ...base,
      assignments: base.assignments.map((a, i) => (i === 0 ? { ...a, pharmacyId: "ph-tampered" } : a)),
    };
    const result = await commitCompleteDraft({ draft, organizationId: ORG, regionId: REGION, userId: USER });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("DRAFT_FINGERPRINT_MISMATCH");
  });

  it("rejects a manifest whose own completeDraftFingerprint disagrees with the draft's, with DRAFT_MANIFEST_MISMATCH", async () => {
    const base = buildValidDraft();
    const draft: CompleteDraftSchedule = {
      ...base,
      manifest: { ...base.manifest, completeDraftFingerprint: "0".repeat(64) },
    };
    const result = await commitCompleteDraft({ draft, organizationId: ORG, regionId: REGION, userId: USER });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("DRAFT_MANIFEST_MISMATCH");
  });

  it("rejects a manifest whose period disagrees with the draft's own period, with DRAFT_MANIFEST_MISMATCH", async () => {
    const base = buildValidDraft();
    const draft: CompleteDraftSchedule = {
      ...base,
      manifest: { ...base.manifest, periodStart: "2026-01-01" },
    };
    const result = await commitCompleteDraft({ draft, organizationId: ORG, regionId: REGION, userId: USER });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("DRAFT_MANIFEST_MISMATCH");
  });

  it("rejects an assignment-count mismatch between draft.assignments and draft.manifest.counts, with DRAFT_MANIFEST_MISMATCH", async () => {
    const base = buildValidDraft();
    expect(base.assignments.length).toBeGreaterThan(0);
    const draft: CompleteDraftSchedule = {
      ...base,
      assignments: base.assignments.slice(0, -1),
    };
    const result = await commitCompleteDraft({ draft, organizationId: ORG, regionId: REGION, userId: USER });
    expect(result.ok).toBe(false);
    // Truncating assignments also changes the byte content, so this may
    // surface as either a fingerprint or manifest inconsistency — both
    // are correct rejections of the same underlying tampering; assert
    // only that SOME structural rejection fired, not a specific code.
    if (!result.ok) {
      expect(["DRAFT_FINGERPRINT_MISMATCH", "DRAFT_MANIFEST_MISMATCH"]).toContain(result.code);
    }
  });

  it("rejects a multi-calendar-month period with DRAFT_MANIFEST_MISMATCH (single-month persistence only)", async () => {
    const plan = makeLoadedPlan();
    const input = makeEngineInput(plan, {
      periodStart: "2026-08-28",
      periodEnd: "2026-09-03",
      configuredRules: buildCompatibilityRules(makeEngineInput(plan).policy),
      configuredSelectionStrategies: [
        buildV1CompatibilitySelectionStrategy({ organizationId: plan.organizationId, regionId: plan.regionId }),
      ],
    });
    const draft = buildDutyEngineContext(input).completeDraftSchedule;
    expect(draft.status).toBe("COMPLETE");
    const result = await commitCompleteDraft({ draft, organizationId: ORG, regionId: REGION, userId: USER });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("DRAFT_MANIFEST_MISMATCH");
  });
});

describe("commitCompleteDraft — tenant mismatch gate", () => {
  it("rejects a mismatched organizationId with DRAFT_TENANT_MISMATCH", async () => {
    const draft = buildValidDraft();
    const result = await commitCompleteDraft({ draft, organizationId: "wrong-org", regionId: REGION, userId: USER });
    expect(result).toEqual({ ok: false, code: "DRAFT_TENANT_MISMATCH", message: expect.any(String) });
  });

  it("rejects a mismatched regionId with DRAFT_TENANT_MISMATCH", async () => {
    const draft = buildValidDraft();
    const result = await commitCompleteDraft({ draft, organizationId: ORG, regionId: "wrong-region", userId: USER });
    expect(result).toEqual({ ok: false, code: "DRAFT_TENANT_MISMATCH", message: expect.any(String) });
  });
});
