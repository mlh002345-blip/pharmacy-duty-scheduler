// Pure region-candidate discovery for the Pharmacy Excel Import feature.
// No Prisma access, no network access, no external service, no AI, no
// hardcoded province/district/region/organization data — every match is
// computed only against the caller-supplied list of the authenticated
// organization's OWN regions, and every "suggestion" is a purely
// structural reading of the uploaded text. See
// docs/features/AUTOMATIC_REGION_DISCOVERY.md.

import { normalizeText } from "@/lib/historical/normalize";

export type RegionCandidateSourceType =
  | "BOLGE_COLUMN"
  | "ILCE_COLUMN"
  | "ADDRESS_SUGGESTION"
  | "MANUAL";

export type RegionCandidateStatus =
  | "MATCHED_EXISTING_ACTIVE"
  | "MATCHED_EXISTING_INACTIVE"
  | "NEW_REGION_CANDIDATE"
  | "ADDRESS_SUGGESTION"
  | "AMBIGUOUS"
  | "UNRESOLVED"
  | "EXCLUDED_BY_ADMIN";

// A structural address hint. "suggestion" carries the extracted district
// text; "ambiguous" means the address has region-like structure that
// could not be reduced to one value; "none" means the address carries no
// usable structure at all.
export type AddressRegionHint =
  | { kind: "suggestion"; value: string }
  | { kind: "ambiguous" }
  | { kind: "none" };

// A token that could plausibly be a Turkish district/region name:
// letters (including Turkish letters), spaces, dots and apostrophes only
// — no digits (which indicate street numbers/postal codes), bounded
// length. Deliberately structural: no national district list is ever
// consulted.
const PLAUSIBLE_NAME_PATTERN = /^[A-Za-zÇĞİÖŞÜçğıöşü][A-Za-zÇĞİÖŞÜçğıöşü .'-]{1,59}$/;

function isPlausibleRegionToken(token: string): boolean {
  return PLAUSIBLE_NAME_PATTERN.test(token.trim());
}

// Extracts a district suggestion from free-form address text using only
// the two structural endings Turkish addresses conventionally carry:
//   "..., <İlçe> / <İl>"  (slash-separated ending)
//   "..., <İlçe>, <İl>"   (comma-separated ending)
// The FIRST part of the ending pair (the district) is the suggestion —
// the trailing part is the province and is never used as a region name.
// Anything with more than one slash in the ending, or with implausible
// tokens, is ambiguous or unusable. This never guesses: a plain street
// address without one of these endings yields "none".
export function parseAddressRegionHint(rawAddress: string): AddressRegionHint {
  const address = rawAddress.trim().replace(/\s+/g, " ");
  if (!address) return { kind: "none" };

  const commaSegments = address
    .split(",")
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);
  if (commaSegments.length === 0) return { kind: "none" };

  const tail = commaSegments[commaSegments.length - 1];
  const slashParts = tail
    .split("/")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);

  if (slashParts.length === 2) {
    // "<İlçe> / <İl>" — the tail may still carry a leading street/
    // neighborhood fragment before the district (e.g. "Cumhuriyet Mah.
    // Merkez/Bilecik"): take only the LAST whitespace-separated token
    // run that stays plausible as the district.
    const districtPart = slashParts[0];
    const districtToken = districtPart.split(" ").at(-1) ?? "";
    if (isPlausibleRegionToken(districtToken) && isPlausibleRegionToken(slashParts[1])) {
      return { kind: "suggestion", value: districtToken };
    }
    return { kind: "ambiguous" };
  }
  if (slashParts.length > 2) {
    return { kind: "ambiguous" };
  }

  // No slash ending: "..., <İlçe>, <İl>" — only when there are at least
  // three comma segments (street part, district, province) is the
  // second-to-last segment structurally a district.
  if (commaSegments.length >= 3) {
    const districtSegment = commaSegments[commaSegments.length - 2];
    const provinceSegment = tail;
    if (isPlausibleRegionToken(districtSegment) && isPlausibleRegionToken(provinceSegment)) {
      return { kind: "suggestion", value: districtSegment };
    }
    return { kind: "ambiguous" };
  }

  return { kind: "none" };
}

// Per-row region source, in the fixed priority order:
//   1. explicit Bölge value (strongest)
//   2. explicit İlçe value
//   3. address-derived suggestion (never auto-approved)
//   4. nothing — the ADMIN resolves it manually during preview.
export type RowRegionSource =
  | { resolved: true; sourceType: Exclude<RegionCandidateSourceType, "MANUAL">; value: string }
  | { resolved: false; reason: "NO_SOURCE" | "AMBIGUOUS_ADDRESS" };

export function resolveRowRegionSource(row: {
  bolge: string;
  ilce: string;
  adres: string;
}): RowRegionSource {
  const bolge = row.bolge.trim().replace(/\s+/g, " ");
  if (bolge) return { resolved: true, sourceType: "BOLGE_COLUMN", value: bolge };

  const ilce = row.ilce.trim().replace(/\s+/g, " ");
  if (ilce) return { resolved: true, sourceType: "ILCE_COLUMN", value: ilce };

  const hint = parseAddressRegionHint(row.adres);
  if (hint.kind === "suggestion") {
    return { resolved: true, sourceType: "ADDRESS_SUGGESTION", value: hint.value };
  }
  if (hint.kind === "ambiguous") {
    return { resolved: false, reason: "AMBIGUOUS_ADDRESS" };
  }
  return { resolved: false, reason: "NO_SOURCE" };
}

export type ExistingRegionForMatching = {
  id: string;
  name: string;
  district: string;
  isActive: boolean;
};

export type DiscoveredRegionCandidate = {
  // Aggregation key: the Turkish-aware normalized source value. Repeated
  // values (any capitalization/Turkish-character variation) collapse
  // into one candidate.
  normalizedSourceValue: string;
  sourceValue: string;
  sourceType: Exclude<RegionCandidateSourceType, "MANUAL">;
  matchedRegionId: string | null;
  matchedRegionName: string | null;
  matchedRegionIsActive: boolean | null;
  proposedName: string;
  proposedDistrict: string;
  proposedIsActive: boolean;
  status: RegionCandidateStatus;
  rowNumbers: number[];
};

export type RegionDiscoveryResult = {
  candidates: DiscoveredRegionCandidate[];
  // rowNumber -> normalized candidate key, for rows that resolved to a
  // candidate; rows absent from this map are unresolved.
  rowCandidateKeys: Map<number, string>;
  // rowNumber -> why the row could not resolve to any candidate.
  unresolvedReasons: Map<number, "NO_SOURCE" | "AMBIGUOUS_ADDRESS">;
};

const SOURCE_STRENGTH: Record<Exclude<RegionCandidateSourceType, "MANUAL">, number> = {
  BOLGE_COLUMN: 3,
  ILCE_COLUMN: 2,
  ADDRESS_SUGGESTION: 1,
};

export function discoverRegionCandidates(
  rows: { rowNumber: number; bolge: string; ilce: string; adres: string }[],
  existingRegions: ExistingRegionForMatching[]
): RegionDiscoveryResult {
  const regionByNormalizedName = new Map(
    existingRegions.map((region) => [normalizeText(region.name), region])
  );

  const candidateByKey = new Map<string, DiscoveredRegionCandidate>();
  const rowCandidateKeys = new Map<number, string>();
  const unresolvedReasons = new Map<number, "NO_SOURCE" | "AMBIGUOUS_ADDRESS">();

  for (const row of rows) {
    const source = resolveRowRegionSource(row);
    if (!source.resolved) {
      unresolvedReasons.set(row.rowNumber, source.reason);
      continue;
    }

    const key = normalizeText(source.value);
    rowCandidateKeys.set(row.rowNumber, key);

    const existing = candidateByKey.get(key);
    if (existing) {
      existing.rowNumbers.push(row.rowNumber);
      // The strongest source wins the candidate's displayed provenance
      // (an explicit Bölge value outranks an İlçe value outranks an
      // address suggestion for the same normalized text).
      if (SOURCE_STRENGTH[source.sourceType] > SOURCE_STRENGTH[existing.sourceType]) {
        existing.sourceType = source.sourceType;
        existing.sourceValue = source.value;
        existing.status = classifyCandidate(source.sourceType, existing.matchedRegionIsActive);
      }
      // The first non-empty İlçe seen among the candidate's rows becomes
      // the proposed district when none was set yet.
      if (!existing.proposedDistrict && row.ilce.trim()) {
        existing.proposedDistrict = row.ilce.trim().replace(/\s+/g, " ");
      }
      continue;
    }

    const matched = regionByNormalizedName.get(key) ?? null;
    const ilceTrimmed = row.ilce.trim().replace(/\s+/g, " ");
    const candidate: DiscoveredRegionCandidate = {
      normalizedSourceValue: key,
      sourceValue: source.value,
      sourceType: source.sourceType,
      matchedRegionId: matched?.id ?? null,
      matchedRegionName: matched?.name ?? null,
      matchedRegionIsActive: matched?.isActive ?? null,
      proposedName: source.value,
      // District proposal: an explicit İlçe on the row, else (when the
      // candidate itself came from the İlçe column or an address
      // suggestion) the value itself, else the value as a final
      // fallback — Region.district is a mandatory column and the ADMIN
      // can edit this before approving.
      proposedDistrict: ilceTrimmed || source.value,
      proposedIsActive: true,
      status: classifyCandidate(source.sourceType, matched ? matched.isActive : null),
      rowNumbers: [row.rowNumber],
    };
    candidateByKey.set(key, candidate);
  }

  return {
    candidates: [...candidateByKey.values()],
    rowCandidateKeys,
    unresolvedReasons,
  };
}

function classifyCandidate(
  sourceType: Exclude<RegionCandidateSourceType, "MANUAL">,
  matchedRegionIsActive: boolean | null
): RegionCandidateStatus {
  // Address-derived values are suggestions ONLY — even when they match
  // an existing region, the ADMIN must confirm before any row may use
  // the match.
  if (sourceType === "ADDRESS_SUGGESTION") return "ADDRESS_SUGGESTION";
  if (matchedRegionIsActive === true) return "MATCHED_EXISTING_ACTIVE";
  if (matchedRegionIsActive === false) return "MATCHED_EXISTING_INACTIVE";
  return "NEW_REGION_CANDIDATE";
}
