import { createHash } from "crypto";

// PUBLIC_LINK talepleri için, açık (PENDING/LATE) taleplerin çift
// gönderimini DB seviyesinde engelleyen deterministik anahtar
// (DutyRequest.dedupKey, @unique). Talep incelendiğinde
// reviewDutyRequestAction bu alanı null'a çevirir, böylece aynı içerikle
// gelecekte yapılacak yeni bir gönderim engellenmez (bkz.
// docs/security/13-transaction-consistency-boundaries.md).
export function computePublicRequestDedupKey(input: {
  pharmacyId: string;
  requestType: string;
  startDate: Date;
  endDate: Date;
  explanation: string;
}): string {
  const canonical = [
    input.pharmacyId,
    input.requestType,
    input.startDate.toISOString(),
    input.endDate.toISOString(),
    input.explanation.trim().toLowerCase(),
    "PUBLIC_LINK",
  ].join("|");
  return createHash("sha256").update(canonical).digest("hex");
}
