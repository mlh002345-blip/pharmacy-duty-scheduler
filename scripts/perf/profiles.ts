export type PerfProfile = {
  name: "quick" | "full";
  regions: number;
  pharmaciesPerRegion: number;
  historicalYears: number;
  historicalDutyRecordTarget: number;
  auditLogTarget: number;
  dutyRequestTarget: number;
  unavailabilityTarget: number;
  dutyScheduleTarget: number;
  scheduleAssignmentDensityCount: number; // how many DutySchedules get a full month of DutyAssignment rows generated
  actorUserCount: number; // "staff" pool referenced by AuditLog/DutyRequest.reviewedBy/DutyBalanceAdjustment.createdBy
  sessionTarget: number;
  loginAttemptTarget: number;
  dutyBalanceAdjustmentTarget: number;
};

// Small, fast — for local iteration/CI-shaped verification. Runs in
// well under a minute on typical hardware.
export const QUICK_PROFILE: PerfProfile = {
  name: "quick",
  regions: 5,
  pharmaciesPerRegion: 40, // 200 pharmacies total
  historicalYears: 1,
  historicalDutyRecordTarget: 5_000,
  auditLogTarget: 2_000,
  dutyRequestTarget: 1_000,
  unavailabilityTarget: 500,
  dutyScheduleTarget: 40,
  scheduleAssignmentDensityCount: 10,
  actorUserCount: 10,
  sessionTarget: 100,
  loginAttemptTarget: 30,
  dutyBalanceAdjustmentTarget: 300,
};

// Matches the task's requested default target profile.
export const FULL_PROFILE: PerfProfile = {
  name: "full",
  regions: 50,
  pharmaciesPerRegion: 100, // 5,000 pharmacies total
  historicalYears: 3,
  historicalDutyRecordTarget: 250_000,
  auditLogTarget: 100_000,
  dutyRequestTarget: 50_000,
  unavailabilityTarget: 20_000,
  dutyScheduleTarget: 2_000,
  scheduleAssignmentDensityCount: 200,
  actorUserCount: 200,
  sessionTarget: 3_000,
  loginAttemptTarget: 500,
  dutyBalanceAdjustmentTarget: 5_000,
};

export function resolveProfile(name: string | undefined): PerfProfile {
  if (name === "full") return FULL_PROFILE;
  return QUICK_PROFILE;
}
