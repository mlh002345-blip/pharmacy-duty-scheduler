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

export type HardBlockingRequestType = "CANNOT_DUTY" | "EMERGENCY_EXCUSE";

export type ApprovedBlockingDutyRequest = {
  pharmacyId: string;
  requestType: HardBlockingRequestType;
  startDate: Date;
  endDate: Date;
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
 * Onaylı CANNOT_DUTY/EMERGENCY_EXCUSE talepleri manuel atamayı da
 * engellemelidir; bu fonksiyon çağrıya yalnızca onaylı, kesin kısıt
 * türündeki talepler geçirildiğini varsayar (status/requestType filtresi
 * çağıran tarafta yapılır).
 */
export function isBlockedByApprovedDutyRequest(params: {
  candidatePharmacyId: string;
  date: Date;
  dutyRequests: ApprovedBlockingDutyRequest[];
}): boolean {
  return params.dutyRequests.some(
    (r) =>
      r.pharmacyId === params.candidatePharmacyId &&
      r.startDate.getTime() <= params.date.getTime() &&
      r.endDate.getTime() >= params.date.getTime()
  );
}

export type ConflictingAssignment = {
  assignmentId: string;
  pharmacyId: string;
  date: Date;
  requestType: HardBlockingRequestType;
  requestStartDate: Date;
  requestEndDate: Date;
};

/**
 * Mevcut atamalar arasında onaylı bir kesin kısıt talebiyle (CANNOT_DUTY /
 * EMERGENCY_EXCUSE) çakışanları bulur — bu fonksiyon uygulanmadan önce
 * oluşturulmuş veya bu düzeltmeden önce manuel olarak girilmiş geçersiz
 * atamaları tespit etmek içindir.
 */
export function findDutyRequestConflicts(params: {
  assignments: ExistingAssignment[];
  dutyRequests: ApprovedBlockingDutyRequest[];
}): ConflictingAssignment[] {
  const conflicts: ConflictingAssignment[] = [];
  for (const assignment of params.assignments) {
    const match = params.dutyRequests.find(
      (r) =>
        r.pharmacyId === assignment.pharmacyId &&
        r.startDate.getTime() <= assignment.date.getTime() &&
        r.endDate.getTime() >= assignment.date.getTime()
    );
    if (match) {
      conflicts.push({
        assignmentId: assignment.id,
        pharmacyId: assignment.pharmacyId,
        date: assignment.date,
        requestType: match.requestType,
        requestStartDate: match.startDate,
        requestEndDate: match.endDate,
      });
    }
  }
  return conflicts;
}

export type DutyRequestForConflictCheck = {
  pharmacyId: string;
  requestType: "CANNOT_DUTY" | "EMERGENCY_EXCUSE" | "PREFER_DUTY" | "SWAP_REQUEST";
  status: "PENDING" | "APPROVED" | "REJECTED" | "CANCELLED" | "LATE";
  startDate: Date;
  endDate: Date;
};

/**
 * findDutyRequestConflicts'ın, status/requestType filtresini de kendi
 * içinde uygulayan hâli — yayınlama gibi, tüm nöbet taleplerinin (herhangi
 * bir durum/tür) ham hâlini elinde bulunduran çağrı yerleri için.
 */
export function findScheduleConflicts(params: {
  assignments: ExistingAssignment[];
  dutyRequests: DutyRequestForConflictCheck[];
}): ConflictingAssignment[] {
  const blocking: ApprovedBlockingDutyRequest[] = params.dutyRequests.filter(
    (r): r is DutyRequestForConflictCheck & { requestType: HardBlockingRequestType } =>
      r.status === "APPROVED" &&
      (r.requestType === "CANNOT_DUTY" || r.requestType === "EMERGENCY_EXCUSE")
  );
  return findDutyRequestConflicts({ assignments: params.assignments, dutyRequests: blocking });
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
