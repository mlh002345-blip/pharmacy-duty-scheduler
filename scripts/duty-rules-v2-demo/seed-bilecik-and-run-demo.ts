// Duty Rules V2 — Phase 10 demo/report generator. NOT a Next.js route,
// NOT wired into prisma/seed.ts — a standalone, one-off tsx script that
// seeds a clearly-Bilecik-themed demo organization and then runs the
// REAL production pipeline (the exact functions the admin UI calls)
// against it: assembleV1CompatibilityEngineInput -> buildDutyEngineContext
// -> commitCompleteDraft -> approveGeneratedDraft -> publishApprovedSchedule.
//
// SAFETY: runs against DATABASE_URL (this is intentional — it seeds
// demo/local data, not test-database-scoped data), but REFUSES to run
// unless DATABASE_URL clearly points at a local/non-production database,
// mirroring the production-marker guard in
// tests/integration/helpers/test-db-guard.ts (hostname must be
// localhost/127.0.0.1, and neither hostname nor database name may
// contain "prod"/"production"/"live"). Every row this script creates is
// idempotent: re-running it finds the existing "Bilecik Demo" org by
// slug and reuses it rather than duplicating rows.
//
// Usage: npm run demo:duty-rules-v2-bilecik

import { PrismaClient } from "@prisma/client";
import { randomBytes } from "node:crypto";

import { hashPassword } from "../../src/lib/auth/password";
import { normalizeText } from "../../src/lib/historical/normalize";
import { assembleV1CompatibilityEngineInput } from "../../src/lib/duty-rules-v2/ui/assemble-v1-compatibility-engine-input";
import { buildDutyEngineContext } from "../../src/lib/duty-rules-v2/engine/build-engine-context";
import { commitCompleteDraft } from "../../src/lib/duty-rules-v2/persistence/commit-complete-draft";
import { approveGeneratedDraft } from "../../src/lib/duty-rules-v2/persistence/approve-generated-draft";
import { publishApprovedSchedule } from "../../src/lib/duty-rules-v2/persistence/publish-approved-schedule";

const PRODUCTION_MARKER_PATTERN = /prod|production|live/i;
const LOCAL_HOST_PATTERN = /^(localhost|127\.0\.0\.1|::1)$/i;

function guardDatabaseUrl(rawUrl: string | undefined): string {
  if (!rawUrl) {
    throw new Error("DATABASE_URL is not set. Refusing to run the Bilecik demo script.");
  }
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error("DATABASE_URL is not a valid connection URL. Refusing to run.");
  }
  const databaseName = parsed.pathname.replace(/^\//, "");
  if (PRODUCTION_MARKER_PATTERN.test(parsed.hostname) || PRODUCTION_MARKER_PATTERN.test(databaseName)) {
    throw new Error(
      `Refusing to run: "${parsed.hostname}/${databaseName}" looks like a production database ` +
        '(hostname or database name contains "prod"/"production"/"live").'
    );
  }
  if (!LOCAL_HOST_PATTERN.test(parsed.hostname)) {
    throw new Error(
      `Refusing to run: DATABASE_URL hostname "${parsed.hostname}" is not local ` +
        "(localhost/127.0.0.1). This script seeds real data and is only meant for a local/demo database."
    );
  }
  return rawUrl;
}

const databaseUrl = guardDatabaseUrl(process.env.DATABASE_URL);
const prisma = new PrismaClient({ datasourceUrl: databaseUrl });

// Bilecik-themed demo data. Real-world district-name accuracy is not the
// point here — internal consistency and a clearly-Bilecik-flavored demo
// is. 11 regions, padded past the province's real 8 districts with 3
// plausible sub-district names so the "11 regions / ~59 pharmacies"
// demo shape holds.
const REGION_NAMES = [
  "Merkez",
  "Bozüyük",
  "Osmaneli",
  "Pazaryeri",
  "Söğüt",
  "Yenipazar",
  "Gölpazarı",
  "İnhisar",
  "Vezirhan",
  "Gölpazarı Kırsal",
  "Bozüyük Sanayi",
];

// Pharmacy count per region (index-aligned with REGION_NAMES), summing
// to 59, with Merkez (index 0) deliberately the largest so it's the
// obvious "representative region" for the V2 plan bootstrap.
const PHARMACY_COUNTS = [12, 8, 6, 5, 5, 5, 5, 4, 4, 3, 2];

function log(message: string): void {
  console.log(`[bilecik-demo] ${message}`);
}

async function ensureOrganization() {
  const slug = "bilecik-demo";
  const existing = await prisma.organization.findUnique({ where: { slug } });
  if (existing) {
    log(`Organizasyon zaten mevcut: ${existing.name} (${existing.id})`);
    return existing;
  }
  const organization = await prisma.organization.create({
    data: {
      name: "Bilecik Eczacı Odası",
      province: "Bilecik",
      slug,
      isActive: true,
    },
  });
  log(`Organizasyon oluşturuldu: ${organization.name} (${organization.id})`);
  return organization;
}

async function ensureAdminUser(organizationId: string) {
  const email = "demo-admin@bilecik-eczaci-odasi.test";
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) return existing;
  return prisma.user.create({
    data: {
      name: "Bilecik Demo Yönetici",
      email,
      passwordHash: await hashPassword("BilecikDemo123!"),
      role: "ADMIN",
      isActive: true,
      organizationId,
    },
  });
}

async function ensureRegionsWithPharmacies(organizationId: string) {
  const regions: { id: string; name: string; pharmacyIds: string[] }[] = [];

  for (let i = 0; i < REGION_NAMES.length; i++) {
    const name = REGION_NAMES[i];
    const pharmacyCount = PHARMACY_COUNTS[i];

    let region = await prisma.region.findUnique({
      where: { organizationId_name: { organizationId, name } },
    });
    if (!region) {
      region = await prisma.region.create({
        data: {
          name,
          district: name,
          dailyDutyCount: 2,
          isActive: true,
          organizationId,
        },
      });
    }

    const dutyRule = await prisma.dutyRule.findUnique({ where: { regionId: region.id } });
    if (!dutyRule) {
      await prisma.dutyRule.create({
        data: {
          regionId: region.id,
          minDaysBetweenDuties: 2,
          weekdayWeight: 1,
          saturdayWeight: 1.25,
          sundayWeight: 1.5,
          officialHolidayWeight: 2,
          religiousHolidayWeight: 2,
        },
      });
    }

    const existingPharmacies = await prisma.pharmacy.findMany({
      where: { regionId: region.id },
      select: { id: true },
    });
    const pharmacyIds = existingPharmacies.map((p) => p.id);

    for (let n = existingPharmacies.length; n < pharmacyCount; n++) {
      const pharmacyName = `${name} Eczanesi ${n + 1}`;
      const pharmacy = await prisma.pharmacy.create({
        data: {
          name: pharmacyName,
          normalizedName: normalizeText(pharmacyName),
          pharmacistName: `${name} Eczacı ${n + 1}`,
          phone: "02281234567",
          address: `${name} Mahallesi, Bilecik`,
          city: "Bilecik",
          district: name,
          requestToken: randomBytes(16).toString("hex"),
          isActive: true,
          regionId: region.id,
        },
      });
      pharmacyIds.push(pharmacy.id);
    }

    regions.push({ id: region.id, name: region.name, pharmacyIds });
  }

  return regions;
}

async function ensureV2PlanBootstrap(
  organizationId: string,
  region: { id: string; name: string; pharmacyIds: string[] }
) {
  let plan = await prisma.dutyPlan.findFirst({
    where: { organizationId, regionId: region.id },
  });
  if (!plan) {
    plan = await prisma.dutyPlan.create({
      data: { name: `${region.name} V2 Planı`, organizationId, regionId: region.id },
    });
  }

  let version = await prisma.dutyPlanVersion.findFirst({
    where: { planId: plan.id, status: "ACTIVE" },
  });
  if (!version) {
    version = await prisma.dutyPlanVersion.create({
      data: {
        planId: plan.id,
        versionNumber: 1,
        status: "ACTIVE",
        validFrom: new Date(),
      },
    });
  }

  let shift = await prisma.shiftDefinition.findFirst({
    where: { planVersionId: version.id, name: "Günlük Nöbet" },
  });
  if (!shift) {
    shift = await prisma.shiftDefinition.create({
      data: {
        planVersionId: version.id,
        name: "Günlük Nöbet",
        startMinute: 0,
        endMinute: 1439,
        spansMidnight: false,
        defaultWeight: 1,
      },
    });
  }

  let pool = await prisma.rotationPool.findFirst({
    where: { organizationId, regionId: region.id },
  });
  if (!pool) {
    pool = await prisma.rotationPool.create({
      data: {
        name: `${region.name} Rotasyon Havuzu`,
        strategy: "FAIRNESS_SCORE",
        organizationId,
        regionId: region.id,
      },
    });
  }

  const existingMemberships = await prisma.rotationPoolMembership.findMany({
    where: { poolId: pool.id },
    select: { pharmacyId: true },
  });
  const memberPharmacyIds = new Set(existingMemberships.map((m) => m.pharmacyId));
  for (const pharmacyId of region.pharmacyIds) {
    if (!memberPharmacyIds.has(pharmacyId)) {
      await prisma.rotationPoolMembership.create({
        data: { poolId: pool.id, pharmacyId, joinedAt: new Date("2026-01-01T00:00:00.000Z") },
      });
    }
  }

  const dayTypes = [
    "WEEKDAY",
    "SATURDAY",
    "SUNDAY",
    "OFFICIAL_HOLIDAY",
    "RELIGIOUS_HOLIDAY",
    "HOLIDAY_EVE",
  ] as const;
  for (const dayType of dayTypes) {
    let rule = await prisma.dayTypeRule.findFirst({
      where: { planVersionId: version.id, dayType, customDayCategory: null },
    });
    if (!rule) {
      rule = await prisma.dayTypeRule.create({
        data: { planVersionId: version.id, dayType, isServed: true },
      });
    }
    const existingSlot = await prisma.slotRequirement.findFirst({
      where: { dayTypeRuleId: rule.id, shiftDefinitionId: shift.id },
    });
    if (!existingSlot) {
      await prisma.slotRequirement.create({
        data: {
          dayTypeRuleId: rule.id,
          shiftDefinitionId: shift.id,
          rotationPoolId: pool.id,
          requiredCount: 2,
        },
      });
    }
  }

  let rotationState = await prisma.rotationState.findFirst({
    where: { poolId: pool.id, dayTypeScope: "ALL" },
  });
  if (!rotationState) {
    rotationState = await prisma.rotationState.create({
      data: { poolId: pool.id, dayTypeScope: "ALL", currentRound: 0, lockVersion: 0 },
    });
  }

  return { plan, version, shift, pool, rotationState };
}

function addMonthsToToday(months: number): { start: string; end: string } {
  const now = new Date();
  const targetYear = now.getUTCFullYear();
  const targetMonth = now.getUTCMonth() + months; // 0-based, may overflow into next year(s)
  const start = new Date(Date.UTC(targetYear, targetMonth, 1));
  const end = new Date(Date.UTC(targetYear, targetMonth + 1, 0));
  const toKey = (d: Date) => d.toISOString().slice(0, 10);
  return { start: toKey(start), end: toKey(end) };
}

async function main() {
  log("Bilecik demo verisi hazırlanıyor...");
  const organization = await ensureOrganization();
  const adminUser = await ensureAdminUser(organization.id);
  const regions = await ensureRegionsWithPharmacies(organization.id);

  const representativeRegion = regions.reduce((max, r) =>
    r.pharmacyIds.length > max.pharmacyIds.length ? r : max
  );
  log(
    `Temsili bölge seçildi: ${representativeRegion.name} (${representativeRegion.pharmacyIds.length} eczane)`
  );

  const bootstrap = await ensureV2PlanBootstrap(organization.id, representativeRegion);

  const period = addMonthsToToday(2);
  log(`Dönem: ${period.start} – ${period.end}`);

  const rotationBefore = await prisma.rotationState.findUniqueOrThrow({
    where: { id: bootstrap.rotationState.id },
  });

  const assembled = await assembleV1CompatibilityEngineInput({
    organizationId: organization.id,
    regionId: representativeRegion.id,
    periodStart: period.start,
    periodEnd: period.end,
  });

  if (!assembled.ok) {
    console.log("\nBilecik Demo Run");
    console.log("=================");
    console.log(`Seçilen bölge: ${representativeRegion.name}`);
    console.log(`Dönem: ${period.start} – ${period.end}`);
    console.log(`HATA: Motor girdisi oluşturulamadı (${assembled.code}): ${assembled.message}`);
    console.log(
      "Not: Bu genellikle aynı bölge/ay için script'in önceki bir çalıştırmasından kalan bir " +
        "çizelgenin (DUPLICATE_SCHEDULE_EXISTS) veya farklı bir aya kaydırılması gerektiğinin " +
        "işaretidir; script her çalıştırmada bugünden +2 ay sonrasını hedefler."
    );
    await prisma.$disconnect();
    process.exitCode = 1;
    return;
  }

  const engineResult = buildDutyEngineContext(assembled.input);
  const draft = engineResult.completeDraftSchedule;

  const commitResult = await commitCompleteDraft({
    draft,
    organizationId: organization.id,
    regionId: representativeRegion.id,
    userId: adminUser.id,
  });

  let approveOutcome = "N/A";
  let approveInfo = "";
  let publishOutcome = "N/A";
  let publishInfo = "";
  let updatedRotationStateCount = 0;
  let scheduleId = "N/A";
  let scheduleStatus = "N/A";

  if (commitResult.ok) {
    scheduleId = commitResult.dutyScheduleId;
    scheduleStatus = commitResult.scheduleStatus;

    const approveResult = await approveGeneratedDraft({
      dutyScheduleId: commitResult.dutyScheduleId,
      organizationId: organization.id,
      userId: adminUser.id,
    });
    if (approveResult.ok) {
      approveOutcome = approveResult.outcome;
      approveInfo = `(approvedBy: ${adminUser.name}, approvedAt: ${approveResult.approvedAt})`;

      const publishResult = await publishApprovedSchedule({
        dutyScheduleId: commitResult.dutyScheduleId,
        organizationId: organization.id,
        userId: adminUser.id,
      });
      if (publishResult.ok) {
        publishOutcome = publishResult.outcome;
        updatedRotationStateCount = publishResult.updatedRotationStateCount;
        publishInfo = `(publishedBy: ${adminUser.name}, publishedAt: ${publishResult.publishedAt}, updatedRotationStateCount: ${updatedRotationStateCount})`;
      } else {
        publishOutcome = `HATA: ${publishResult.code} — ${publishResult.message}`;
      }
    } else {
      approveOutcome = `HATA: ${approveResult.code} — ${approveResult.message}`;
    }
  }

  const rotationAfter = await prisma.rotationState.findUniqueOrThrow({
    where: { id: bootstrap.rotationState.id },
  });

  console.log("\nBilecik Demo Run");
  console.log("=================");
  console.log(`Seçilen bölge: ${representativeRegion.name}`);
  console.log(`Dönem: ${period.start} – ${period.end}`);
  console.log(`Atama sayısı: ${draft.counts.totalAssignments}`);
  console.log(
    `Uyarı sayısı: ${draft.diagnostics.filter((d) => d.severity === "WARNING").length}`
  );
  console.log(`Taslak durumu: ${draft.status}`);
  console.log(
    `Kaydedilen çizelge durumu: ${scheduleStatus} (id: ${scheduleId})${
      commitResult.ok ? "" : ` — HATA: ${commitResult.code} — ${commitResult.message}`
    }`
  );
  console.log(`Onay sonucu: ${approveOutcome} ${approveInfo}`);
  console.log(`Yayın sonucu: ${publishOutcome} ${publishInfo}`);
  console.log(
    `RotationState değişiklikleri: currentRound ${rotationBefore.currentRound} -> ${rotationAfter.currentRound}, ` +
      `lockVersion ${rotationBefore.lockVersion} -> ${rotationAfter.lockVersion}, ` +
      `lastServedMembershipId ${rotationBefore.lastServedMembershipId ?? "null"} -> ${rotationAfter.lastServedMembershipId ?? "null"}`
  );

  await prisma.$disconnect();
}

main().catch(async (error) => {
  console.error("[bilecik-demo] Beklenmeyen hata:", error);
  await prisma.$disconnect();
  process.exitCode = 1;
});
