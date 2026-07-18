"use client";

import { Badge } from "@/components/ui/badge";
import { ConfirmSubmitForm } from "@/components/layout/confirm-submit-form";
import type { ActivationIssue } from "@/lib/duty-rules-v2/configuration/validate-plan-version-completeness";
import { activatePlanVersionAction } from "./actions";

const ISSUE_LABELS: Record<string, string> = {
  REGION_INACTIVE: "Bölge pasif durumda.",
  SERVED_DAY_TYPE_WITHOUT_SLOTS: "Nöbet tutulan bir gün tipi için slot gereksinimi tanımlanmamış.",
  SLOT_WITHOUT_POOL: "Bir slot gereksinimi için rotasyon havuzu seçilmemiş.",
  POOL_EMPTY_AS_OF_EFFECTIVE_DATE: "Bir rotasyon havuzunun geçerlilik tarihinde üyesi yok.",
  SLOT_ON_UNSERVED_DAY_TYPE: "Nöbet tutulmayan bir gün tipi için slot gereksinimi tanımlanmış.",
  EFFECTIVE_DATE_OUTSIDE_VALIDITY: "Geçerlilik tarihi sürümün geçerlilik aralığının dışında.",
  NO_SERVED_DAY_TYPES: "Hiçbir gün tipi için nöbet tutulmuyor (plan hiçbir zaman atama üretmez).",
  LOADER_ERROR: "Plan yapılandırması yüklenirken bir sorun tespit edildi.",
};

function issueLabel(issue: ActivationIssue): string {
  return ISSUE_LABELS[issue.code] ?? issue.code;
}

export function ActivationSection({
  planId,
  versionId,
  regionId,
  isAdmin,
  isDraft,
  blockingIssues,
  advisoryIssues,
}: {
  planId: string;
  versionId: string;
  regionId: string;
  isAdmin: boolean;
  isDraft: boolean;
  blockingIssues: ActivationIssue[];
  advisoryIssues: ActivationIssue[];
}) {
  const canActivate = isAdmin && isDraft && blockingIssues.length === 0;

  return (
    <div className="flex flex-col gap-3">
      {blockingIssues.length > 0 && (
        <div className="rounded-md border border-destructive/50 bg-destructive/10 p-3">
          <p className="text-destructive text-sm font-medium">Engelleyici Sorunlar</p>
          <ul className="text-destructive mt-1 list-disc pl-5 text-sm">
            {blockingIssues.map((issue, i) => (
              <li key={i}>{issueLabel(issue)}</li>
            ))}
          </ul>
        </div>
      )}
      {advisoryIssues.length > 0 && (
        <div className="rounded-md border border-amber-500/50 bg-amber-500/10 p-3">
          <p className="text-sm font-medium text-amber-700">Uyarılar</p>
          <ul className="mt-1 list-disc pl-5 text-sm text-amber-700">
            {advisoryIssues.map((issue, i) => (
              <li key={i}>{issueLabel(issue)}</li>
            ))}
          </ul>
        </div>
      )}
      {blockingIssues.length === 0 && advisoryIssues.length === 0 && (
        <Badge variant="success">Etkinleştirmeye hazır.</Badge>
      )}

      {isDraft ? (
        isAdmin ? (
          <div>
            <ConfirmSubmitForm
              action={activatePlanVersionAction.bind(null, planId, versionId, regionId)}
              confirmMessage="Bu sürümü etkinleştirmek, bu bölge için başka bir etkin sürüm varsa onu emekliye ayıracak ve bu sürümün gelecekteki düzenlemelerini dondurulacaktır. Devam edilsin mi?"
              pendingText="Etkinleştiriliyor..."
              disabled={!canActivate}
            >
              Sürümü Etkinleştir
            </ConfirmSubmitForm>
            {!canActivate && (
              <p className="text-muted-foreground mt-1 text-xs">
                Etkinleştirmeden önce yukarıdaki engelleyici sorunları çözün.
              </p>
            )}
          </div>
        ) : (
          <p className="text-muted-foreground text-sm">
            Sürümü etkinleştirmek için yönetici yetkisi gereklidir.
          </p>
        )
      ) : (
        <p className="text-muted-foreground text-sm">Bu sürüm zaten DRAFT durumunda değil.</p>
      )}
    </div>
  );
}
