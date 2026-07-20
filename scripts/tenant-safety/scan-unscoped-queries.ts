import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

// Tenant-owned Prisma models (directly or through a non-nullable parent FK).
// Holiday and LoginAttempt are deliberately excluded — both are shared/global
// by design (see docs/architecture/MULTI_TENANCY.md and CLAUDE.md).
const TENANT_MODELS = [
  "user",
  "region",
  "pharmacy",
  // Owned through its parent Region (regionId -> region.organizationId) —
  // see prisma/schema.prisma's ServiceArea comment.
  "serviceArea",
  "dutyRule",
  "dutySchedule",
  "dutyAssignment",
  "dutyScheduleWarning",
  "dutyRequest",
  "unavailability",
  "dutyBalanceAdjustment",
  "historicalDutyRecord",
  "historicalDutyImportBatch",
  "auditLog",
  "pharmacyImportBatch",
  "pharmacyImportRow",
  // Duty Rules V2 (Phase 1 schema): all owned by the organization either
  // directly (dutyPlan, rotationPool) or through a parent chain
  // (version -> plan, dayTypeRule/shiftDefinition -> version, slot ->
  // dayTypeRule, membership/state -> pool). Every read must be scoped
  // from the root — see src/lib/duty-rules-v2/plan-version-repository.ts.
  "dutyPlan",
  "dutyPlanVersion",
  "dayTypeRule",
  "shiftDefinition",
  "slotRequirement",
  "rotationPool",
  "rotationPoolMembership",
  "rotationState",
  // Duty Rules V2 Phase 8: owned directly (organizationId/regionId
  // columns), see commit-complete-draft.ts.
  "dutyGenerationRun",
];

// Every Prisma method that can read/write rows and therefore needs a tenant
// boundary on its `where` (or, for create, in `data`).
const SCOPED_METHODS = [
  "findMany",
  "findFirst",
  "findUnique",
  "findUniqueOrThrow",
  "findFirstOrThrow",
  "count",
  "aggregate",
  "groupBy",
  "update",
  "updateMany",
  "delete",
  "deleteMany",
  "create",
  "createMany",
  "upsert",
];

// `key: file:line` -> reason. Every entry here was reviewed by hand; a call
// only belongs on this list if the tenant boundary is enforced some other
// way at that exact call site (e.g. the id/regionId used was already
// verified against organizationId earlier in the same function, or the
// model itself is scoped through a caller-supplied, already-validated
// parent id). Never add an entry here to silence a real gap — fix the
// query instead.
//
// Every reason is tagged with one of these safety categories:
//   [parent-scoped query]   the id used at this call site was already
//                            validated against organizationId earlier in
//                            the same request (directly, or via a parent
//                            relation chain the caller validated).
//   [pre-auth login path]   runs before any session/organization context
//                            exists — it IS the identity boundary, not a
//                            tenant-scoped read.
//   [platform-only operation]  reserved for PLATFORM_ADMIN-only code paths
//                            that intentionally operate across all
//                            organizations; unused today (no such Prisma
//                            call exists yet) — kept here so a future
//                            entry has a category to land under instead of
//                            inventing a new one.
// (Holiday is a shared/global model by design — see CLAUDE.md scheduling
// principles — and is deliberately kept out of TENANT_MODELS below rather
// than allowlisted per call site; do not add "holiday" there.
// [cleanup-test infrastructure] doesn't apply here either, since this
// scanner only walks src/, never tests/.)
const ALLOWLIST: Record<string, string> = {
  "src/lib/scheduling/generate-and-save-duty-schedule.ts:39": "[parent-scoped query] region.findFirst is intentionally not used here — regionId is documented as pre-validated by every caller (see GenerateAndSaveDutyScheduleInput comment) before this function runs.",
  "src/lib/scheduling/generate-and-save-duty-schedule.ts:52": "[parent-scoped query] pharmacies scoped by regionId, which the caller has already validated belongs to organizationId.",
  "src/lib/scheduling/generate-and-save-duty-schedule.ts:71": "[parent-scoped query] unavailability scoped by pharmacyIds derived from the already-org-validated region's own pharmacies.",
  "src/lib/scheduling/generate-and-save-duty-schedule.ts:78": "[parent-scoped query] dutyAssignment scoped by pharmacyIds derived from the already-org-validated region's own pharmacies.",
  "src/lib/scheduling/generate-and-save-duty-schedule.ts:89": "[parent-scoped query] dutyRequest scoped by pharmacyIds derived from the already-org-validated region's own pharmacies.",
  "src/lib/scheduling/generate-and-save-duty-schedule.ts:114": "[parent-scoped query] dutySchedule.create's regionId was already validated by the caller against organizationId; DutySchedule has no direct organizationId column (ownership derives through region).",
  "src/lib/scheduling/schedule-precheck.ts:148": "[parent-scoped query] unavailability scoped by activePharmacyIds, which the caller (cizelgeler/actions.ts) already validated belong to the authenticated user's organization.",
  "src/lib/scheduling/schedule-precheck.ts:156": "[parent-scoped query] dutyRequest scoped by activePharmacyIds, caller-validated.",
  "src/lib/scheduling/schedule-precheck.ts:166": "[parent-scoped query] dutyRequest count scoped by activePharmacyIds, caller-validated.",
  "src/lib/scheduling/schedule-precheck.ts:169": "[parent-scoped query] historicalDutyRecord.count scoped by regionId, caller-validated (see other schedule-precheck.ts entries above).",
  "src/lib/scheduling/schedule-precheck.ts:171": "[parent-scoped query] pharmacy count scoped by activePharmacyIds, caller-validated.",
  "src/lib/scheduling/public-duty-lookup.ts:10": "[parent-scoped query] dutySchedule scoped by regionId, which the only caller (/vatandas) resolves from an organization-scoped region list before calling this.",
  "src/lib/scheduling/public-duty-lookup.ts:24": "[parent-scoped query] dutyAssignment scoped by the schedule.id resolved from the org-scoped lookup immediately above.",
  "src/app/eczane-talep/[token]/page.tsx:34": "[parent-scoped query] pharmacy resolved by requestToken — a per-pharmacy unique, unguessable secret that is itself the authorization boundary for this public route; it can never resolve to another organization's pharmacy.",
  "src/app/eczane-talep/[token]/actions.ts:40": "[parent-scoped query] pharmacy resolved by requestToken, same reasoning as page.tsx above; pharmacyId/regionId used later in this function are derived from this lookup, never client-supplied.",
  "src/app/eczane-talep/[token]/actions.ts:58": "[parent-scoped query] dutyRequest.count scoped by pharmacy.id, resolved from the requestToken lookup above — never client-supplied.",
  "src/app/eczane-talep/[token]/actions.ts:82": "[parent-scoped query] dutyRequest.create's pharmacyId/regionId are taken from the token-resolved pharmacy, never client input.",
  "src/lib/auth/actions.ts:74": "[pre-auth login path] User looked up by globally-unique email during login, before any organization/session context exists — this is the identity boundary itself, not a tenant-scoped read.",
  "src/app/platform/kurumlar/actions.ts:96": "[platform-only operation] pre-check for the new first-ADMIN's email against the globally-unique User.email constraint, guarded by requirePlatformAdmin(); intentionally organization-agnostic since email uniqueness is global, not per-tenant.",
  "src/lib/auth/password-reset.ts:46": "[pre-auth password-reset path] User looked up by globally-unique email during a self-service 'forgot password' request, before any session/organization context exists — same identity-boundary exception as the login path (src/lib/auth/actions.ts). Always returns the same generic response regardless of match, so no enumeration is possible.",
  "src/lib/auth/password-reset.ts:123": "[token-scoped mutation] userId here comes only from an already-validated, single-use PasswordResetToken row (found by its own unpredictable token value, not client-supplied) — the token itself is the authorization boundary, exactly like Session-token lookups elsewhere in src/lib/auth/session.ts, which are likewise organization-agnostic by design.",
  "src/app/(dashboard)/cizelgeler/[id]/atama/assignment-actions.ts:115": "[parent-scoped query] dutyRequest scoped by candidatePharmacyId, which was already verified against organizationId a few lines above (the cross-tenant relation validation on the client-supplied pharmacyId).",
  "src/app/(dashboard)/cizelgeler/[id]/atama/assignment-actions.ts:148": "[parent-scoped query] dutyAssignment scoped by candidatePharmacyId, same prior verification as above.",
  "src/app/(dashboard)/cizelgeler/[id]/page.tsx:141": "[parent-scoped query] dutyRequest groupBy scoped by pharmacy.regionId === schedule.regionId, where schedule was already loaded with an organizationId-scoped findFirst above.",
  "src/app/(dashboard)/cizelgeler/[id]/page.tsx:166": "[parent-scoped query] dutyRequest scoped by assignmentPharmacyIds, derived only from this org-validated schedule's own assignments.",
  "src/app/(dashboard)/cizelgeler/[id]/page.tsx:227": "[parent-scoped query] historicalDutyRecord groupBy scoped by pharmacyIds derived from this org-validated schedule's own assignments (fairnessRows).",
  "src/app/(dashboard)/cizelgeler/[id]/page.tsx:232": "[parent-scoped query] dutyBalanceAdjustment groupBy scoped by the same org-validated pharmacyIds.",
  "src/app/(dashboard)/cizelgeler/[id]/page.tsx:237": "[parent-scoped query] dutyAssignment groupBy scoped by the same org-validated pharmacyIds.",
  "src/app/(dashboard)/cizelgeler/actions.ts:98": "[parent-scoped query] dutySchedule.findUnique by the compound (year, month, regionId) key — regionId was already verified against organizationId a few lines above via the region findFirst.",
  "src/lib/balance/duty-balance.ts:164": "[parent-scoped query] getOpeningBalanceByPharmacy's historicalDutyRecord groupBy is scoped by the regionId parameter, which the sole caller (generate-and-save-duty-schedule.ts) has already validated against organizationId.",
  "src/lib/balance/duty-balance.ts:173": "[parent-scoped query] getOpeningBalanceByPharmacy's dutyBalanceAdjustment groupBy, same caller-validated regionId as above.",
  // Duty Rules V2 Phase 12: the shared runtime-fact helper extracted from
  // assemble-v1-compatibility-engine-input.ts (Phase 10) — both callers
  // (that file's assembleV1CompatibilityEngineInput and the new
  // assemble-v2-native-engine-input.ts's assembleV2NativeEngineInput)
  // validate regionId against organizationId via their own region
  // lookup BEFORE calling this helper, then pass only the resulting
  // org-validated pharmacyIds in. Every query below is scoped by those
  // pharmacyIds — never client-supplied directly. (Superseded the
  // previous per-line entries under assemble-v1-compatibility-engine-
  // input.ts, which pointed at these exact queries before they were
  // extracted here.)
  "src/lib/duty-rules-v2/ui/fetch-engine-runtime-facts.ts:57": "[parent-scoped query] unavailability scoped by pharmacyIds, which every caller has already derived from an org-validated region's own active pharmacies.",
  "src/lib/duty-rules-v2/ui/fetch-engine-runtime-facts.ts:66": "[parent-scoped query] dutyRequest (APPROVED-only) scoped by the same caller-validated pharmacyIds.",
  "src/lib/duty-rules-v2/ui/fetch-engine-runtime-facts.ts:82": "[parent-scoped query] dutyAssignment (historical, date < periodStart) scoped by the same caller-validated pharmacyIds.",
  "src/lib/duty-rules-v2/ui/fetch-engine-runtime-facts.ts:90": "[parent-scoped query] dutyBalanceAdjustment scoped by the same caller-validated pharmacyIds.",
  // Duty Rules V2 Phase 13: manual assignment editing.
  "src/app/(dashboard)/cizelgeler/[id]/atama/[assignmentId]/v2-duzenle/page.tsx:67": "[parent-scoped query] dutyRequest scoped by date range only for a pool-membership candidate list already derived from an org-validated assignment/schedule a few lines above — mirrors the identical pattern already allowlisted for the V1 edit page.",
  "src/app/(dashboard)/cizelgeler/[id]/atama/v2-assignment-actions.ts:144": "[parent-scoped query] dutyRequest scoped by candidatePharmacyId, which was already verified against organizationId a few lines above (the cross-tenant relation validation on the client-supplied pharmacyId) — same pattern as assignment-actions.ts:115.",
  "src/lib/duty-rules-v2/persistence-edit/resolve-min-interval-policy.ts:18": "[parent-scoped query] dutySchedule.findUnique by id only — its sole caller (editV2DutyAssignmentAction) has already tenant-validated this exact dutyScheduleId via the assignment's own org-scoped lookup before calling this helper; this module never receives an organizationId to scope with directly.",
  "src/app/kayit/actions.ts:85": "[pre-auth login path] pre-check for the new self-service organization's first-ADMIN email against the globally-unique User.email constraint, on a public unauthenticated signup route — no organizationId exists yet at this point, exactly like the platform-admin equivalent (src/app/platform/kurumlar/actions.ts:96).",
};

type Finding = { file: string; line: number; snippet: string };

function scanFile(path: string, content: string): Finding[] {
  const findings: Finding[] = [];
  const lines = content.split("\n");
  const callPattern = new RegExp(
    `\\b(?:prisma|tx)\\.(${TENANT_MODELS.join("|")})\\.(${SCOPED_METHODS.join("|")})\\(`
  );

  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(callPattern);
    if (!match) continue;

    const lineNo = i + 1;
    const key = `${path}:${lineNo}`;
    if (ALLOWLIST[key]) continue;

    // Look at a window of surrounding lines for evidence of tenant
    // scoping: an explicit organizationId, or a relation chain that
    // terminates in one (region: { organizationId ... }, pharmacy: {
    // region: { organizationId ... } }, etc.), or a compound-unique key
    // that embeds organizationId (organizationId_name). The backward half
    // of the window exists because this codebase's common pattern is
    // `const where = { organizationId, ... }; ... prisma.x.count({ where })`
    // — the scoping lives a few lines above the call, not inside it.
    const windowStart = Math.max(0, i - 40);
    const windowEnd = Math.min(lines.length, i + 25);
    const window = lines.slice(windowStart, windowEnd).join("\n");
    if (/organizationId/.test(window)) continue;

    findings.push({ file: path, line: lineNo, snippet: lines[i].trim() });
  }

  return findings;
}

function walk(dir: string, out: string[]): void {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      walk(full, out);
    } else if (
      (entry.endsWith(".ts") || entry.endsWith(".tsx")) &&
      !entry.endsWith(".test.ts") &&
      !entry.endsWith(".test.tsx")
    ) {
      out.push(full);
    }
  }
}

export async function scanUnscopedTenantQueries(root: string = process.cwd()): Promise<Finding[]> {
  const files: string[] = [];
  walk(join(root, "src"), files);

  const findings: Finding[] = [];
  for (const file of files) {
    const content = readFileSync(file, "utf8");
    findings.push(...scanFile(relative(root, file), content));
  }
  return findings;
}

async function main() {
  const findings = await scanUnscopedTenantQueries();
  if (findings.length === 0) {
    console.log("tenant-safety scan: no unscoped tenant-owned Prisma calls found.");
    return;
  }
  console.error(`tenant-safety scan: ${findings.length} unscoped tenant-owned Prisma call(s) found:\n`);
  for (const f of findings) {
    console.error(`  ${f.file}:${f.line}  ${f.snippet}`);
  }
  process.exitCode = 1;
}

if (require.main === module) {
  main();
}
