import { describe, expect, it } from "vitest";

import {
  findDutyRequestConflicts,
  findMinDaysBetweenDutiesViolation,
  isAlreadyAssignedOnDate,
  isBlockedByApprovedDutyRequest,
  isEligibleReplacementPharmacy,
  isUnavailableOnDate,
} from "./duty-assignment-edit";
import { dateAtUtcMidnight } from "./date-tr";

const REGION_ID = "region-1";

describe("isEligibleReplacementPharmacy", () => {
  it("accepts an active pharmacy in the same region", () => {
    expect(
      isEligibleReplacementPharmacy(
        { id: "p1", isActive: true, regionId: REGION_ID },
        REGION_ID
      )
    ).toBe(true);
  });

  it("rejects an inactive pharmacy", () => {
    expect(
      isEligibleReplacementPharmacy(
        { id: "p1", isActive: false, regionId: REGION_ID },
        REGION_ID
      )
    ).toBe(false);
  });

  it("rejects a pharmacy from a different region", () => {
    expect(
      isEligibleReplacementPharmacy(
        { id: "p1", isActive: true, regionId: "region-2" },
        REGION_ID
      )
    ).toBe(false);
  });
});

describe("isAlreadyAssignedOnDate", () => {
  const date = dateAtUtcMidnight(2026, 4, 10);

  it("detects a conflicting assignment on the same date", () => {
    const result = isAlreadyAssignedOnDate({
      assignmentId: "current",
      candidatePharmacyId: "p2",
      date,
      scheduleAssignments: [
        { id: "current", pharmacyId: "p1", date },
        { id: "other", pharmacyId: "p2", date },
      ],
    });
    expect(result).toBe(true);
  });

  it("ignores the assignment being edited itself", () => {
    const result = isAlreadyAssignedOnDate({
      assignmentId: "current",
      candidatePharmacyId: "p1",
      date,
      scheduleAssignments: [{ id: "current", pharmacyId: "p1", date }],
    });
    expect(result).toBe(false);
  });

  it("allows a candidate with no conflicting assignment", () => {
    const result = isAlreadyAssignedOnDate({
      assignmentId: "current",
      candidatePharmacyId: "p3",
      date,
      scheduleAssignments: [
        { id: "current", pharmacyId: "p1", date },
        { id: "other", pharmacyId: "p2", date },
      ],
    });
    expect(result).toBe(false);
  });
});

describe("isUnavailableOnDate", () => {
  it("detects a date within an unavailability range", () => {
    const result = isUnavailableOnDate({
      candidatePharmacyId: "p1",
      date: dateAtUtcMidnight(2026, 4, 10),
      unavailabilities: [
        {
          pharmacyId: "p1",
          startDate: dateAtUtcMidnight(2026, 4, 5),
          endDate: dateAtUtcMidnight(2026, 4, 15),
        },
      ],
    });
    expect(result).toBe(true);
  });

  it("allows a date outside any unavailability range", () => {
    const result = isUnavailableOnDate({
      candidatePharmacyId: "p1",
      date: dateAtUtcMidnight(2026, 4, 20),
      unavailabilities: [
        {
          pharmacyId: "p1",
          startDate: dateAtUtcMidnight(2026, 4, 5),
          endDate: dateAtUtcMidnight(2026, 4, 15),
        },
      ],
    });
    expect(result).toBe(false);
  });
});

describe("isBlockedByApprovedDutyRequest", () => {
  it("blocks a date covered by an approved CANNOT_DUTY request", () => {
    const result = isBlockedByApprovedDutyRequest({
      candidatePharmacyId: "p1",
      date: dateAtUtcMidnight(2026, 4, 10),
      dutyRequests: [
        {
          pharmacyId: "p1",
          requestType: "CANNOT_DUTY",
          startDate: dateAtUtcMidnight(2026, 4, 5),
          endDate: dateAtUtcMidnight(2026, 4, 15),
        },
      ],
    });
    expect(result).toBe(true);
  });

  it("blocks a date covered by an approved EMERGENCY_EXCUSE request", () => {
    const result = isBlockedByApprovedDutyRequest({
      candidatePharmacyId: "p1",
      date: dateAtUtcMidnight(2026, 4, 10),
      dutyRequests: [
        {
          pharmacyId: "p1",
          requestType: "EMERGENCY_EXCUSE",
          startDate: dateAtUtcMidnight(2026, 4, 10),
          endDate: dateAtUtcMidnight(2026, 4, 10),
        },
      ],
    });
    expect(result).toBe(true);
  });

  it("allows a date outside the approved request range", () => {
    const result = isBlockedByApprovedDutyRequest({
      candidatePharmacyId: "p1",
      date: dateAtUtcMidnight(2026, 4, 20),
      dutyRequests: [
        {
          pharmacyId: "p1",
          requestType: "CANNOT_DUTY",
          startDate: dateAtUtcMidnight(2026, 4, 5),
          endDate: dateAtUtcMidnight(2026, 4, 15),
        },
      ],
    });
    expect(result).toBe(false);
  });

  it("allows a different pharmacy on the same blocked date", () => {
    const result = isBlockedByApprovedDutyRequest({
      candidatePharmacyId: "p2",
      date: dateAtUtcMidnight(2026, 4, 10),
      dutyRequests: [
        {
          pharmacyId: "p1",
          requestType: "CANNOT_DUTY",
          startDate: dateAtUtcMidnight(2026, 4, 5),
          endDate: dateAtUtcMidnight(2026, 4, 15),
        },
      ],
    });
    expect(result).toBe(false);
  });
});

describe("findDutyRequestConflicts", () => {
  it("finds an existing assignment that conflicts with an approved CANNOT_DUTY request", () => {
    const conflicts = findDutyRequestConflicts({
      assignments: [
        { id: "a1", pharmacyId: "p1", date: dateAtUtcMidnight(2026, 4, 10) },
        { id: "a2", pharmacyId: "p2", date: dateAtUtcMidnight(2026, 4, 11) },
      ],
      dutyRequests: [
        {
          pharmacyId: "p1",
          requestType: "CANNOT_DUTY",
          startDate: dateAtUtcMidnight(2026, 4, 5),
          endDate: dateAtUtcMidnight(2026, 4, 15),
        },
      ],
    });
    expect(conflicts.length).toBe(1);
    expect(conflicts[0].assignmentId).toBe("a1");
    expect(conflicts[0].requestType).toBe("CANNOT_DUTY");
  });

  it("returns no conflicts when no assignment overlaps an approved request", () => {
    const conflicts = findDutyRequestConflicts({
      assignments: [{ id: "a1", pharmacyId: "p1", date: dateAtUtcMidnight(2026, 4, 20) }],
      dutyRequests: [
        {
          pharmacyId: "p1",
          requestType: "CANNOT_DUTY",
          startDate: dateAtUtcMidnight(2026, 4, 5),
          endDate: dateAtUtcMidnight(2026, 4, 15),
        },
      ],
    });
    expect(conflicts.length).toBe(0);
  });
});

describe("findMinDaysBetweenDutiesViolation", () => {
  it("returns the gap when another duty is too close", () => {
    const gap = findMinDaysBetweenDutiesViolation({
      assignmentId: "current",
      candidatePharmacyId: "p1",
      date: dateAtUtcMidnight(2026, 4, 10),
      minDaysBetweenDuties: 7,
      otherAssignments: [
        { id: "other", pharmacyId: "p1", date: dateAtUtcMidnight(2026, 4, 6) },
      ],
    });
    expect(gap).toBe(4);
  });

  it("returns null when the nearest duty satisfies the minimum gap", () => {
    const gap = findMinDaysBetweenDutiesViolation({
      assignmentId: "current",
      candidatePharmacyId: "p1",
      date: dateAtUtcMidnight(2026, 4, 10),
      minDaysBetweenDuties: 7,
      otherAssignments: [
        { id: "other", pharmacyId: "p1", date: dateAtUtcMidnight(2026, 4, 1) },
      ],
    });
    expect(gap).toBeNull();
  });

  it("ignores the assignment being edited and other pharmacies", () => {
    const gap = findMinDaysBetweenDutiesViolation({
      assignmentId: "current",
      candidatePharmacyId: "p1",
      date: dateAtUtcMidnight(2026, 4, 10),
      minDaysBetweenDuties: 7,
      otherAssignments: [
        { id: "current", pharmacyId: "p1", date: dateAtUtcMidnight(2026, 4, 10) },
        { id: "other-pharmacy", pharmacyId: "p2", date: dateAtUtcMidnight(2026, 4, 9) },
      ],
    });
    expect(gap).toBeNull();
  });

  it("checks gaps in both directions from the candidate date", () => {
    const gap = findMinDaysBetweenDutiesViolation({
      assignmentId: "current",
      candidatePharmacyId: "p1",
      date: dateAtUtcMidnight(2026, 4, 10),
      minDaysBetweenDuties: 7,
      otherAssignments: [
        { id: "future", pharmacyId: "p1", date: dateAtUtcMidnight(2026, 4, 13) },
      ],
    });
    expect(gap).toBe(3);
  });

  it("does not flag a violation when minDaysBetweenDuties is 0", () => {
    const gap = findMinDaysBetweenDutiesViolation({
      assignmentId: "current",
      candidatePharmacyId: "p1",
      date: dateAtUtcMidnight(2026, 4, 10),
      minDaysBetweenDuties: 0,
      otherAssignments: [
        { id: "other", pharmacyId: "p1", date: dateAtUtcMidnight(2026, 4, 10) },
      ],
    });
    expect(gap).toBeNull();
  });
});
