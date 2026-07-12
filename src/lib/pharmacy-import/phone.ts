// Turkish national phone-number normalization for the Pharmacy Excel
// Import feature. Purely structural (Turkish numbering-plan digit
// counts: a 3-digit area/operator code + 7-digit subscriber number) —
// never derives an area code from an organization/region/province name,
// and never guesses a missing area code. See
// docs/features/PHARMACY_EXCEL_IMPORT.md for the full row-validation
// rules this implements.

export type PhoneNormalizationResult =
  | { ok: true; value: string }
  | { ok: false; errorCode: "missing_default_area_code" | "invalid_default_area_code" | "unrecognized_phone_format" };

const DEFAULT_AREA_CODE_PATTERN = /^\d{3}$/;

export function isValidDefaultAreaCode(value: string): boolean {
  return DEFAULT_AREA_CODE_PATTERN.test(value);
}

function formatCanonical(areaCode: string, subscriber: string): string {
  return `+90 ${areaCode} ${subscriber.slice(0, 3)} ${subscriber.slice(3, 5)} ${subscriber.slice(5, 7)}`;
}

// Resolves a raw, freely-formatted phone cell to the canonical
// "+90 AAA NNN NN NN" form, or a reason-coded failure — never throws,
// never silently accepts an ambiguous value.
export function normalizePhoneNumber(
  rawPhone: string,
  defaultAreaCode: string | null
): PhoneNormalizationResult {
  const digits = rawPhone.replace(/\D/g, "");

  let national: string | null = null;

  if (digits.length === 12 && digits.startsWith("90")) {
    national = digits.slice(2);
  } else if (digits.length === 11 && digits.startsWith("0")) {
    national = digits.slice(1);
  } else if (digits.length === 10 && !digits.startsWith("0")) {
    // A valid Turkish area/operator code never starts with 0 — a
    // 10-digit string starting with 0 is an ambiguous/malformed input,
    // not a valid area+subscriber pair, and falls through to the
    // unrecognized-format branch below.
    national = digits;
  } else if (digits.length === 7) {
    if (defaultAreaCode === null || defaultAreaCode === "") {
      return { ok: false, errorCode: "missing_default_area_code" };
    }
    if (!isValidDefaultAreaCode(defaultAreaCode)) {
      return { ok: false, errorCode: "invalid_default_area_code" };
    }
    national = defaultAreaCode + digits;
  }

  if (!national || national.length !== 10) {
    return { ok: false, errorCode: "unrecognized_phone_format" };
  }

  const areaCode = national.slice(0, 3);
  const subscriber = national.slice(3);
  return { ok: true, value: formatCanonical(areaCode, subscriber) };
}
