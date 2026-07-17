// Duty Rules V2 — Phase 7: Complete Draft Schedule fingerprint.
//
// completeDraftFingerprint = sha256 over the canonical serialization of
// the whole draft MINUS the fingerprint field itself (and minus the
// manifest, which embeds validation counts derived from — and therefore
// circular with — the fingerprint's own inputs; the manifest's
// sourceResultFingerprint is what actually anchors provenance). Because
// every component is deterministically ordered and derived only from
// explicit Phase 4-6 output, byte-identical inputs always produce
// byte-identical fingerprints.

import { sha256Canonical } from "../engine/build-selection-input";
import type { CompleteDraftSchedule } from "./domain/draft-schedule";

export function computeCompleteDraftFingerprint(
  draft: Omit<CompleteDraftSchedule, "completeDraftFingerprint" | "manifest">
): string {
  return sha256Canonical(draft);
}
