// Duty Rules V2 — Phase 7: Complete Draft Schedule fingerprint.
//
// completeDraftFingerprint = sha256Canonical(payload), where payload is
// EXACTLY:
//
//   { engineVersion, selectionEngineVersion, generationMode, periodStart,
//     periodEnd, provenance, days, assignments, counts, diagnostics,
//     status, isCommitEligible, sourceResultFingerprint }
//
// i.e. the whole CompleteDraftSchedule MINUS `completeDraftFingerprint`
// itself and MINUS `manifest` (the manifest embeds
// completeDraftFingerprint and validation counts DERIVED FROM this same
// payload, so including it would be circular), PLUS the upstream
// `sourceResultFingerprint` (the Phase 4-6 DutyEngineDraftResult's own
// resultFingerprint) so this fingerprint is sensitive to upstream
// changes even when they happen not to alter any field this draft
// itself projects.
//
// sha256Canonical (build-selection-input.ts) serializes via
// canonicalSerialize (v1-adapter.ts): object keys are sorted
// recursively, so key ORDER never affects the hash. Set-like arrays
// embedded in the payload (days[].slots[].assignments[], diagnostics[],
// etc.) are already deterministically ordered by assembly itself
// (draftAssignmentKey / slotKey / date+code+subjectKey ASC) — this
// function does not re-sort them; it trusts (and Phase 7's own
// determinism tests verify) that assembly already produced canonical
// order, so byte-identical inputs always produce byte-identical
// fingerprints regardless of any UPSTREAM array order (e.g. holiday
// input order, candidate array order) that assembly has already
// normalized away.
//
// Every behavior-relevant fact that affects the draft — selected
// pharmacy, assignment order, ordinal, origin, duty weight, resolved day
// type, compatibility weight fact, required/selected counts, underfill/
// unresolved status, strategy id/type, fallback use, decisive
// criterion, and every diagnostic code (blocking or not) — is a
// component of `days`/`assignments`/`counts`/`diagnostics`/`status`
// above, so a change to any of them changes the fingerprint. Purely
// cosmetic facts that are NOT part of this payload (e.g. a pharmacy's
// display name is embedded via `pharmacyName` — see the fingerprint
// SENSITIVITY test file for the explicit list of what does and does not
// affect the hash) never do.

import { sha256Canonical } from "../engine/build-selection-input";
import type { CompleteDraftSchedule } from "./domain/draft-schedule";

export function computeCompleteDraftFingerprint(
  draft: Omit<CompleteDraftSchedule, "completeDraftFingerprint" | "manifest"> & {
    /** The upstream Phase 4-6 resultFingerprint this draft was assembled
     *  from. Included IN the hashed payload (unlike the rest of the
     *  manifest, which is excluded) specifically so
     *  completeDraftFingerprint is sensitive to upstream changes even
     *  when they happen not to alter any other field this draft
     *  projects — e.g. a Phase 4-6 change that only touches provenance
     *  bookkeeping. */
    sourceResultFingerprint: string;
  }
): string {
  return sha256Canonical(draft);
}
