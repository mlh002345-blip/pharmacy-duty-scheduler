import { diffInDays } from "./date-tr";

export type ExistingAssignment = {
  id: string;
  pharmacyId: string;
  date: Date;
};

export type UnavailabilityRange = {
  pharmacyId: string;
  startDate: Date;
  endDate: Date;
};

export type CandidatePharmacy = {
  id: string;
  isActive: boolean;
  regionId: string;
};

export function isEligibleReplacementPharmacy(
  candidate: CandidatePharmacy,
  regionId: string
): boolean {
  return candidate.isActive && candidate.regionId === regionId;
}

export function isAlreadyAssignedOnDate(params: {
  assignmentId: string;
  candidatePharmacyId: string;
  date: Date;
  scheduleAssignments: ExistingAssignment[];
}): boolean {
  return params.scheduleAssignments.some(
    (a) =>
      a.id !== params.assignmentId &&
      a.pharmacyId === params.candidatePharmacyId &&
      a.date.getTime() === params.date.getTime()
  );
}

export function isUnavailableOnDate(params: {
  candidatePharmacyId: string;
  date: Date;
  unavailabilities: UnavailabilityRange[];
}): boolean {
  return params.unavailabilities.some(
    (u) =>
      u.pharmacyId === params.candidatePharmacyId &&
      u.startDate.getTime() <= params.date.getTime() &&
      u.endDate.getTime() >= params.date.getTime()
  );
}

/**
 * Returns the smallest gap in days between the candidate date and any other
 * duty of the candidate pharmacy, if that gap is shorter than
 * minDaysBetweenDuties. Returns null when the rule is satisfied.
 */
export function findMinDaysBetweenDutiesViolation(params: {
  assignmentId: string;
  candidatePharmacyId: string;
  date: Date;
  minDaysBetweenDuties: number;
  otherAssignments: ExistingAssignment[];
}): number | null {
  if (params.minDaysBetweenDuties <= 0) return null;

  let nearestGap: number | null = null;
  for (const assignment of params.otherAssignments) {
    if (assignment.id === params.assignmentId) continue;
    if (assignment.pharmacyId !== params.candidatePharmacyId) continue;
    const gap = Math.abs(diffInDays(params.date, assignment.date));
    if (nearestGap === null || gap < nearestGap) nearestGap = gap;
  }

  if (nearestGap !== null && nearestGap < params.minDaysBetweenDuties) {
    return nearestGap;
  }
  return null;
}
