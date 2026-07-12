import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

// Tenant-owned Prisma models (directly or through a non-nullable parent FK).
// Holiday and LoginAttempt are deliberately excluded — both are shared/global
// by design (see docs/architecture/MULTI_TENANCY.md and CLAUDE.md).
const TENANT_MODELS = [
  "user",
  "region",
  "pharmacy",
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
const ALLOWLIST: Record<string, string> = {
  "src/lib/scheduling/generate-and-save-duty-schedule.ts:39": "region.findFirst is intentionally not used here — regionId is documented as pre-validated by every caller (see GenerateAndSaveDutyScheduleInput comment) before this function runs.",
  "src/lib/scheduling/generate-and-save-duty-schedule.ts:52": "pharmacies scoped by regionId, which the caller has already validated belongs to organizationId.",
  "src/lib/scheduling/generate-and-save-duty-schedule.ts:71": "unavailability scoped by pharmacyIds derived from the already-org-validated region's own pharmacies.",
  "src/lib/scheduling/generate-and-save-duty-schedule.ts:78": "dutyAssignment scoped by pharmacyIds derived from the already-org-validated region's own pharmacies.",
  "src/lib/scheduling/generate-and-save-duty-schedule.ts:89": "dutyRequest scoped by pharmacyIds derived from the already-org-validated region's own pharmacies.",
  "src/lib/scheduling/schedule-precheck.ts:148": "unavailability scoped by activePharmacyIds, which the caller (cizelgeler/actions.ts) already validated belong to the authenticated user's organization.",
  "src/lib/scheduling/schedule-precheck.ts:156": "dutyRequest scoped by activePharmacyIds, caller-validated.",
  "src/lib/scheduling/schedule-precheck.ts:166": "dutyRequest count scoped by activePharmacyIds, caller-validated.",
  "src/lib/scheduling/schedule-precheck.ts:171": "pharmacy count scoped by activePharmacyIds, caller-validated.",
  "src/lib/scheduling/public-duty-lookup.ts:10": "dutySchedule scoped by regionId, which the only caller (/vatandas) resolves from an organization-scoped region list before calling this.",
  "src/lib/scheduling/public-duty-lookup.ts:24": "dutyAssignment scoped by the schedule.id resolved from the org-scoped lookup immediately above.",
  "src/app/eczane-talep/[token]/page.tsx:34": "pharmacy resolved by requestToken — a per-pharmacy unique, unguessable secret that is itself the authorization boundary for this public route; it can never resolve to another organization's pharmacy.",
  "src/app/eczane-talep/[token]/actions.ts:40": "pharmacy resolved by requestToken, same reasoning as page.tsx above; pharmacyId/regionId used later in this function are derived from this lookup, never client-supplied.",
  "src/app/(dashboard)/tatil-gunleri/actions.ts:89": "Holiday is a shared/global table by design (national/religious calendar facts, not chamber-owned data) — see CLAUDE.md scheduling principles.",
  "src/app/(dashboard)/tatil-gunleri/actions.ts:127": "Holiday is shared/global, see above.",
  "src/app/(dashboard)/tatil-gunleri/[id]/duzenle/page.tsx:16": "Holiday is shared/global, see above.",
  "src/lib/auth/actions.ts:74": "User looked up by globally-unique email during login, before any organization/session context exists — this is the identity boundary itself, not a tenant-scoped read.",
  "src/app/(dashboard)/cizelgeler/[id]/atama/assignment-actions.ts:115": "dutyRequest scoped by candidatePharmacyId, which was already verified against organizationId a few lines above (the cross-tenant relation validation on the client-supplied pharmacyId).",
  "src/app/(dashboard)/cizelgeler/[id]/atama/assignment-actions.ts:148": "dutyAssignment scoped by candidatePharmacyId, same prior verification as above.",
  "src/app/(dashboard)/cizelgeler/[id]/page.tsx:119": "dutyRequest groupBy scoped by pharmacy.regionId === schedule.regionId, where schedule was already loaded with an organizationId-scoped findFirst above.",
  "src/app/(dashboard)/cizelgeler/[id]/page.tsx:144": "dutyRequest scoped by assignmentPharmacyIds, derived only from this org-validated schedule's own assignments.",
  "src/app/(dashboard)/cizelgeler/[id]/page.tsx:205": "historicalDutyRecord groupBy scoped by pharmacyIds derived from this org-validated schedule's own assignments (fairnessRows).",
  "src/app/(dashboard)/cizelgeler/[id]/page.tsx:210": "dutyBalanceAdjustment groupBy scoped by the same org-validated pharmacyIds.",
  "src/app/(dashboard)/cizelgeler/[id]/page.tsx:215": "dutyAssignment groupBy scoped by the same org-validated pharmacyIds.",
  "src/app/(dashboard)/cizelgeler/actions.ts:86": "dutySchedule.findUnique by the compound (year, month, regionId) key — regionId was already verified against organizationId a few lines above via the region findFirst.",
  "src/app/eczane-talep/[token]/actions.ts:58": "dutyRequest.count scoped by pharmacy.id, resolved from the requestToken lookup above — never client-supplied.",
  "src/app/eczane-talep/[token]/actions.ts:82": "dutyRequest.create's pharmacyId/regionId are taken from the token-resolved pharmacy, never client input.",
  "src/lib/balance/duty-balance.ts:164": "getOpeningBalanceByPharmacy's historicalDutyRecord groupBy is scoped by the regionId parameter, which the sole caller (generate-and-save-duty-schedule.ts) has already validated against organizationId.",
  "src/lib/balance/duty-balance.ts:173": "getOpeningBalanceByPharmacy's dutyBalanceAdjustment groupBy, same caller-validated regionId as above.",
  "src/lib/scheduling/generate-and-save-duty-schedule.ts:114": "dutySchedule.create's regionId was already validated by the caller against organizationId; DutySchedule has no direct organizationId column (ownership derives through region).",
  "src/lib/scheduling/schedule-precheck.ts:169": "historicalDutyRecord.count scoped by regionId, caller-validated (see other schedule-precheck.ts entries above).",
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
