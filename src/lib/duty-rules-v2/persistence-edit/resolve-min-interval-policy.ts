// Duty Rules V2 — Phase 13: manual assignment editing. Derives which
// minDaysBetweenDuties value (if any) governs the interval-violation
// warning shown when manually editing an assignment, for BOTH V1 rows
// and every V2 mode (native-policy and V1-compatibility). See Phase 13
// investigation finding #6: the V1 edit action only ever reads
// region.dutyRule.minDaysBetweenDuties, which is null for a native-mode
// V2 region (no DutyRule row at all) — silently skipping the warning.
// This module fixes that gap without touching the V1 action itself.

import { prisma } from "@/lib/prisma";

export type ResolveMinIntervalPolicyParams = { dutyScheduleId: string };
export type ResolveMinIntervalPolicyResult = { minDaysBetweenDuties: number } | null;

export async function resolveMinIntervalPolicy(
  params: ResolveMinIntervalPolicyParams
): Promise<ResolveMinIntervalPolicyResult> {
  const schedule = await prisma.dutySchedule.findUnique({
    where: { id: params.dutyScheduleId },
    select: {
      generationRun: {
        select: { planVersion: { select: { minDaysBetweenDuties: true } } },
      },
      region: {
        select: { dutyRule: { select: { minDaysBetweenDuties: true } } },
      },
    },
  });
  if (!schedule) return null;

  // Precedence: (a) native V2 policy on the plan version wins whenever
  // configured, even if a legacy DutyRule also happens to exist; (b)
  // otherwise fall back to the region's DutyRule (V1, or V1-compatibility
  // mode V2); (c) otherwise no interval policy applies — same as V1's own
  // behavior when there is no DutyRule at all.
  const nativeValue = schedule.generationRun?.planVersion?.minDaysBetweenDuties;
  if (typeof nativeValue === "number") {
    return { minDaysBetweenDuties: nativeValue };
  }

  const dutyRuleValue = schedule.region?.dutyRule?.minDaysBetweenDuties;
  if (typeof dutyRuleValue === "number") {
    return { minDaysBetweenDuties: dutyRuleValue };
  }

  return null;
}
