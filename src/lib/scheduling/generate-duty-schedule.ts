import {
  dateAtUtcMidnight,
  daysInMonth,
  diffInDays,
  isSaturday,
  isSunday,
  isWeekend,
  toDateKey,
} from "./date-tr";

export type HolidayTypeInput = "OFFICIAL" | "RELIGIOUS" | "OTHER";

export type CandidatePharmacy = {
  id: string;
  name: string;
  isActive: boolean;
  regionId: string;
};

export type HolidayInput = {
  date: Date;
  name: string;
  type: HolidayTypeInput;
};

export type UnavailabilityInput = {
  pharmacyId: string;
  startDate: Date;
  endDate: Date;
};

export type HistoricalAssignmentInput = {
  pharmacyId: string;
  date: Date;
  weight: number;
};

export type DutyRuleWeights = {
  minDaysBetweenDuties: number;
  weekdayWeight: number;
  saturdayWeight: number;
  sundayWeight: number;
  officialHolidayWeight: number;
  religiousHolidayWeight: number;
};

export type DutyRequestInput = {
  pharmacyId: string;
  requestType: "CANNOT_DUTY" | "PREFER_DUTY" | "SWAP_REQUEST" | "EMERGENCY_EXCUSE";
  status: "PENDING" | "APPROVED" | "REJECTED" | "CANCELLED" | "LATE";
  startDate: Date;
  endDate: Date;
};

export type GenerateDutyScheduleParams = {
  month: number;
  year: number;
  regionId: string;
  dailyDutyCount: number;
  dutyRule: DutyRuleWeights;
  pharmacies: CandidatePharmacy[];
  holidays: HolidayInput[];
  unavailabilities: UnavailabilityInput[];
  historicalAssignments: HistoricalAssignmentInput[];
  // Başlangıç nöbet dengesi: geçmiş nöbet puanı + manuel denge düzeltmeleri.
  // Tarihsiz toplam puandır; yalnızca denge skorunu etkiler, asgari nöbet
  // aralığı hesabına karışmaz.
  openingBalance?: Map<string, number>;
  // Nöbet talepleri: yalnızca APPROVED durumundakiler etki eder.
  // CANNOT_DUTY ve EMERGENCY_EXCUSE tarih aralığında atamayı engeller (kesin
  // kısıt); PREFER_DUTY eşit yük durumunda önceliklendirir (esnek tercih).
  dutyRequests?: DutyRequestInput[];
};

export type GeneratedAssignment = {
  date: Date;
  pharmacyId: string;
  weight: number;
  note: string | null;
};

export type GeneratedWarning = {
  date: Date;
  message: string;
};

export type GenerateDutyScheduleResult = {
  assignments: GeneratedAssignment[];
  warnings: GeneratedWarning[];
  // Kullanıcıya gösterilecek bilgilendirme mesajları (uyarı değildir).
  info: string[];
};

type PharmacyMetrics = {
  totalDuties: number;
  weekendDuties: number;
  holidayDuties: number;
  totalLoadScore: number;
  lastDutyDate: Date | null;
};

function createEmptyMetrics(): PharmacyMetrics {
  return {
    totalDuties: 0,
    weekendDuties: 0,
    holidayDuties: 0,
    totalLoadScore: 0,
    lastDutyDate: null,
  };
}

function resolveDutyWeight(
  date: Date,
  holiday: HolidayInput | undefined,
  dutyRule: DutyRuleWeights
): number {
  if (holiday) {
    if (holiday.type === "RELIGIOUS") return dutyRule.religiousHolidayWeight;
    // OFFICIAL and OTHER both use the official holiday weight for now.
    return dutyRule.officialHolidayWeight;
  }
  if (isSaturday(date)) return dutyRule.saturdayWeight;
  if (isSunday(date)) return dutyRule.sundayWeight;
  return dutyRule.weekdayWeight;
}

function isUnavailable(
  pharmacyId: string,
  date: Date,
  unavailabilities: UnavailabilityInput[]
): boolean {
  return unavailabilities.some(
    (u) =>
      u.pharmacyId === pharmacyId &&
      u.startDate.getTime() <= date.getTime() &&
      u.endDate.getTime() >= date.getTime()
  );
}

export function generateDutySchedule(
  params: GenerateDutyScheduleParams
): GenerateDutyScheduleResult {
  const {
    month,
    year,
    regionId,
    dailyDutyCount,
    dutyRule,
    pharmacies,
    holidays,
    unavailabilities,
    historicalAssignments,
    openingBalance,
    dutyRequests,
  } = params;

  // Hard rule: only active pharmacies in the selected region are eligible.
  const eligiblePharmacies = pharmacies.filter(
    (p) => p.isActive && p.regionId === regionId
  );

  const metrics = new Map<string, PharmacyMetrics>();
  for (const pharmacy of eligiblePharmacies) {
    const entry = createEmptyMetrics();
    // Başlangıç nöbet dengesi (geçmiş yük + manuel düzeltmeler) doğrudan
    // denge skoruna eklenir; tarih içermediği için minDaysBetweenDuties
    // hesabını etkilemez.
    entry.totalLoadScore = openingBalance?.get(pharmacy.id) ?? 0;
    metrics.set(pharmacy.id, entry);
  }

  // Yalnızca onaylı talepler etki eder.
  const approvedRequests = (dutyRequests ?? []).filter(
    (request) => request.status === "APPROVED"
  );
  const blockingRequests = approvedRequests.filter(
    (request) =>
      request.requestType === "CANNOT_DUTY" ||
      request.requestType === "EMERGENCY_EXCUSE"
  );
  const preferRequests = approvedRequests.filter(
    (request) => request.requestType === "PREFER_DUTY"
  );

  const isBlockedByRequest = (pharmacyId: string, date: Date) =>
    blockingRequests.some(
      (request) =>
        request.pharmacyId === pharmacyId &&
        request.startDate.getTime() <= date.getTime() &&
        request.endDate.getTime() >= date.getTime()
    );

  const hasPreferenceForDate = (pharmacyId: string, date: Date) =>
    preferRequests.some(
      (request) =>
        request.pharmacyId === pharmacyId &&
        request.startDate.getTime() <= date.getTime() &&
        request.endDate.getTime() >= date.getTime()
    );

  for (const historical of historicalAssignments) {
    const entry = metrics.get(historical.pharmacyId);
    if (!entry) continue;
    entry.totalDuties += 1;
    entry.totalLoadScore += historical.weight;
    if (isWeekend(historical.date)) entry.weekendDuties += 1;
    if (!entry.lastDutyDate || historical.date > entry.lastDutyDate) {
      entry.lastDutyDate = historical.date;
    }
  }

  const holidayByDateKey = new Map<string, HolidayInput>();
  for (const holiday of holidays) {
    holidayByDateKey.set(toDateKey(holiday.date), holiday);
  }

  const assignments: GeneratedAssignment[] = [];
  const warnings: GeneratedWarning[] = [];

  const totalDays = daysInMonth(year, month);

  for (let day = 1; day <= totalDays; day++) {
    const date = dateAtUtcMidnight(year, month, day);
    const holiday = holidayByDateKey.get(toDateKey(date));
    const weight = resolveDutyWeight(date, holiday, dutyRule);
    const dateIsWeekend = isWeekend(date);

    const availableToday = eligiblePharmacies.filter(
      (p) =>
        !isUnavailable(p.id, date, unavailabilities) &&
        !isBlockedByRequest(p.id, date)
    );

    const strictlyEligible = availableToday.filter((p) => {
      const entry = metrics.get(p.id)!;
      if (!entry.lastDutyDate) return true;
      return diffInDays(date, entry.lastDutyDate) >= dutyRule.minDaysBetweenDuties;
    });

    // Respect minDaysBetweenDuties where possible; relax it only if there
    // aren't enough strictly-eligible pharmacies to fill the day's quota.
    const candidatePool =
      strictlyEligible.length >= dailyDutyCount ? strictlyEligible : availableToday;

    const sorted = [...candidatePool].sort((a, b) => {
      const metricsA = metrics.get(a.id)!;
      const metricsB = metrics.get(b.id)!;

      if (metricsA.totalLoadScore !== metricsB.totalLoadScore) {
        return metricsA.totalLoadScore - metricsB.totalLoadScore;
      }
      // Onaylı "Nöbet Tercihi": denge bozulmadan (eşit yükte) tarih
      // aralığını tercih eden eczaneye öncelik verilir.
      const prefersA = hasPreferenceForDate(a.id, date);
      const prefersB = hasPreferenceForDate(b.id, date);
      if (prefersA !== prefersB) {
        return prefersA ? -1 : 1;
      }
      if (metricsA.totalDuties !== metricsB.totalDuties) {
        return metricsA.totalDuties - metricsB.totalDuties;
      }
      if (dateIsWeekend && metricsA.weekendDuties !== metricsB.weekendDuties) {
        return metricsA.weekendDuties - metricsB.weekendDuties;
      }
      if (holiday && metricsA.holidayDuties !== metricsB.holidayDuties) {
        return metricsA.holidayDuties - metricsB.holidayDuties;
      }
      if (metricsA.lastDutyDate !== metricsB.lastDutyDate) {
        if (!metricsA.lastDutyDate) return -1;
        if (!metricsB.lastDutyDate) return 1;
        return metricsA.lastDutyDate.getTime() - metricsB.lastDutyDate.getTime();
      }
      return a.name.localeCompare(b.name, "tr");
    });

    const selected = sorted.slice(0, dailyDutyCount);

    if (selected.length < dailyDutyCount) {
      warnings.push({
        date,
        message: "Bu tarih için yeterli uygun eczane bulunamadı.",
      });
    }

    for (const pharmacy of selected) {
      assignments.push({
        date,
        pharmacyId: pharmacy.id,
        weight,
        note: holiday?.name ?? null,
      });

      const entry = metrics.get(pharmacy.id)!;
      entry.totalDuties += 1;
      entry.totalLoadScore += weight;
      if (dateIsWeekend) entry.weekendDuties += 1;
      if (holiday) entry.holidayDuties += 1;
      entry.lastDutyDate = date;
    }
  }

  const info: string[] = [];
  const hasOpeningBalance = eligiblePharmacies.some(
    (p) => (openingBalance?.get(p.id) ?? 0) !== 0
  );
  if (hasOpeningBalance) {
    info.push("Geçmiş nöbet yükleri denge skoruna dahil edildi.");
  }
  if (blockingRequests.length > 0) {
    info.push(
      `Onaylı nöbet talepleri çizelge oluşturulurken dikkate alındı. Bu çizelgede ${blockingRequests.length} onaylı nöbet tutamama talebi dikkate alındı.`
    );
  }

  return { assignments, warnings, info };
}
