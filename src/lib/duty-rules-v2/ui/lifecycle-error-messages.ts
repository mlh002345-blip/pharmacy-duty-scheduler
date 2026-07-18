// Duty Rules V2 — Phase 10: shared Turkish error-code -> message maps for
// the admin UI's commit/approve/publish server actions. Every code here
// is enumerated verbatim from the Phase 8/9 services themselves
// (commit-complete-draft.ts, approve-generated-draft.ts,
// publish-approved-schedule.ts) — this module adds NO new error
// semantics, only user-facing Turkish text. Messages deliberately never
// disclose tenant-existence details beyond what the underlying service
// itself already decided to return.

import type { CommitCompleteDraftErrorCode } from "../persistence/commit-complete-draft";
import type { ApproveGeneratedDraftErrorCode } from "../persistence/approve-generated-draft";
import type { PublishApprovedScheduleErrorCode } from "../persistence/publish-approved-schedule";
import type { AssembleEngineInputErrorCode } from "./assemble-v1-compatibility-engine-input";
import type { AssembleNativeEngineInputErrorCode } from "./assemble-v2-native-engine-input";

export const COMMIT_DRAFT_ERROR_MESSAGES: Record<CommitCompleteDraftErrorCode, string> = {
  DRAFT_NOT_COMMIT_ELIGIBLE: "Taslak kaydedilmeye uygun değil (eksik veya geçersiz).",
  DRAFT_FINGERPRINT_MISMATCH:
    "Taslak içeriği bozulmuş görünüyor. Lütfen taslağı yeniden oluşturun.",
  DRAFT_MANIFEST_MISMATCH:
    "Taslak özet bilgileri tutarsız. Lütfen taslağı yeniden oluşturun.",
  DRAFT_TENANT_MISMATCH: "Bu kayda erişim yetkiniz yok.",
  DRAFT_REFERENCE_MISMATCH:
    "Taslaktaki bazı referanslar artık geçerli değil. Lütfen taslağı yeniden oluşturun.",
  DRAFT_ALREADY_COMMITTED: "Bu taslak zaten kaydedilmiş.",
  DRAFT_TARGET_CONFLICT:
    "Bu bölge için seçilen dönemde farklı bir nöbet çizelgesi zaten mevcut.",
  DRAFT_TRANSACTION_FAILED:
    "Taslak kaydedilirken beklenmeyen bir hata oluştu. Lütfen tekrar deneyin.",
};

export const APPROVE_DRAFT_ERROR_MESSAGES: Record<ApproveGeneratedDraftErrorCode, string> = {
  SCHEDULE_NOT_FOUND: "Nöbet çizelgesi bulunamadı.",
  TENANT_MISMATCH: "Bu kayda erişim yetkiniz yok.",
  GENERATION_RUN_MISSING:
    "Bu çizelge V2 ile oluşturulmamış; onay yalnızca V2 taslakları için geçerlidir.",
  SCHEDULE_NOT_DRAFT: "Çizelge taslak durumunda değil.",
  SCHEDULE_ALREADY_PUBLISHED: "Yayınlanmış bir çizelge onaylanamaz.",
  GENERATION_RECORD_CORRUPTED: "Üretim kaydı tutarsız görünüyor. Lütfen destek ile iletişime geçin.",
  APPROVAL_TRANSACTION_FAILED: "Onay sırasında beklenmeyen bir hata oluştu. Lütfen tekrar deneyin.",
};

export const PUBLISH_SCHEDULE_ERROR_MESSAGES: Record<PublishApprovedScheduleErrorCode, string> = {
  SCHEDULE_NOT_FOUND: "Nöbet çizelgesi bulunamadı.",
  TENANT_MISMATCH: "Bu kayda erişim yetkiniz yok.",
  GENERATION_RUN_MISSING:
    "Bu çizelge V2 ile oluşturulmamış; yayınlama yalnızca V2 çizelgeleri için geçerlidir.",
  SCHEDULE_NOT_APPROVED: "Çizelge önce onaylanmalıdır.",
  GENERATION_RECORD_CORRUPTED: "Üretim kaydı tutarsız görünüyor. Lütfen destek ile iletişime geçin.",
  ROTATION_STATE_CONFLICT:
    "İlgili rotasyon durumu onaydan bu yana değişmiş; çizelge güvenle yayınlanamıyor. Lütfen tekrar deneyin.",
  PUBLICATION_TARGET_CONFLICT: "Yayınlama eşzamanlılık çakışmasından sonra tamamlanamadı.",
  PUBLICATION_TRANSACTION_FAILED:
    "Yayınlama sırasında beklenmeyen bir hata oluştu. Lütfen tekrar deneyin.",
};

export const ASSEMBLE_ENGINE_INPUT_ERROR_FIELD: Record<AssembleEngineInputErrorCode, string> = {
  REGION_NOT_FOUND: "regionId",
  NO_DUTY_RULE: "regionId",
  NO_ACTIVE_PLAN_VERSION: "regionId",
  NO_ACTIVE_PHARMACIES: "regionId",
  INVALID_PERIOD: "periodEnd",
  DUPLICATE_SCHEDULE_EXISTS: "periodStart",
};

// Duty Rules V2 — Phase 12: the native-policy assembler's own error
// codes, kept as a separate map (rather than unified with the one above)
// because the two error-code enums are only partially overlapping and a
// unified Record type would have to accept the union of both codes for
// every entry — a separate map is simpler and keeps each mode's field
// mapping independently reviewable.
export const ASSEMBLE_NATIVE_ENGINE_INPUT_ERROR_FIELD: Record<
  AssembleNativeEngineInputErrorCode,
  string
> = {
  REGION_NOT_FOUND: "regionId",
  NO_ACTIVE_PLAN_VERSION: "regionId",
  POLICY_NOT_CONFIGURED: "regionId",
  MISSING_DAY_TYPE_WEIGHT: "regionId",
  NO_ACTIVE_PHARMACIES: "regionId",
  INVALID_PERIOD: "periodEnd",
  DUPLICATE_SCHEDULE_EXISTS: "periodStart",
};
