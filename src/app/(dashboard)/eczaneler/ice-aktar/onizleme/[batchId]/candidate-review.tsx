// Server-rendered "Bölge Eşleştirme ve Onay" section of the import
// preview: one decision panel per unique region candidate plus the
// manual candidate form. All forms post to bound Server Actions —
// nothing here runs client-side JavaScript.

import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { SubmitButton } from "@/components/layout/submit-button";
import {
  approveRegionCandidateAction,
  createManualRegionCandidateAction,
  excludeRegionCandidateAction,
  matchRegionCandidateAction,
  resetRegionCandidateAction,
  updateRegionCandidateAction,
} from "../../candidate-actions";

export type CandidateForReview = {
  id: string;
  sourceValue: string;
  sourceType: string;
  status: string;
  proposedName: string;
  proposedCity: string;
  proposedDistrict: string;
  proposedIsActive: boolean;
  approvedAt: Date | null;
  reactivateOnImport: boolean;
  matchedRegion: { id: string; name: string; isActive: boolean } | null;
  rowCount: number;
};

export type RegionOption = { id: string; name: string; isActive: boolean };

const SOURCE_LABELS: Record<string, string> = {
  BOLGE_COLUMN: "Bölge sütunu",
  ILCE_COLUMN: "İlçe sütunu",
  ADDRESS_SUGGESTION: "Adres önerisi",
  MANUAL: "Manuel",
};

const STATUS_LABELS: Record<string, string> = {
  MATCHED_EXISTING_ACTIVE: "Mevcut Bölgeyle Eşleşti",
  MATCHED_EXISTING_INACTIVE: "Pasif Bölgeyle Eşleşti",
  NEW_REGION_CANDIDATE: "Yeni Bölge Adayı",
  ADDRESS_SUGGESTION: "Adres Önerisi",
  AMBIGUOUS: "Belirsiz",
  UNRESOLVED: "Çözümlenemedi",
  EXCLUDED_BY_ADMIN: "Kapsam Dışı",
};

function statusVariant(candidate: CandidateForReview): "success" | "destructive" | "secondary" | "info" {
  if (candidate.status === "MATCHED_EXISTING_ACTIVE") return "success";
  if (candidate.status === "EXCLUDED_BY_ADMIN") return "secondary";
  if (candidate.approvedAt) return "success";
  if (candidate.status === "ADDRESS_SUGGESTION") return "info";
  return "destructive";
}

function MatchExistingForm({
  candidate,
  regions,
}: {
  candidate: CandidateForReview;
  regions: RegionOption[];
}) {
  if (regions.length === 0) return null;
  return (
    <form
      action={matchRegionCandidateAction.bind(null, candidate.id)}
      className="flex items-end gap-2"
    >
      <div className="w-56">
        <Label htmlFor={`match-${candidate.id}`} className="text-xs">
          Mevcut bölgeyle eşleştir
        </Label>
        <Select id={`match-${candidate.id}`} name="regionId" defaultValue="">
          <option value="" disabled>
            Bölge seçin…
          </option>
          {regions.map((region) => (
            <option key={region.id} value={region.id}>
              {region.name}
              {region.isActive ? "" : " (pasif)"}
            </option>
          ))}
        </Select>
      </div>
      <SubmitButton variant="outline" size="sm" pendingText="Eşleştiriliyor...">
        Eşleştir
      </SubmitButton>
    </form>
  );
}

function EditForm({ candidate }: { candidate: CandidateForReview }) {
  return (
    <form
      action={updateRegionCandidateAction.bind(null, candidate.id)}
      className="flex flex-wrap items-end gap-2"
    >
      <div className="w-44">
        <Label htmlFor={`name-${candidate.id}`} className="text-xs">
          Önerilen bölge adı
        </Label>
        <Input
          id={`name-${candidate.id}`}
          name="proposedName"
          defaultValue={candidate.proposedName}
          required
        />
      </div>
      <div className="w-36">
        <Label htmlFor={`city-${candidate.id}`} className="text-xs">
          İl
        </Label>
        <Input
          id={`city-${candidate.id}`}
          name="proposedCity"
          defaultValue={candidate.proposedCity}
          required
        />
      </div>
      <div className="w-36">
        <Label htmlFor={`district-${candidate.id}`} className="text-xs">
          İlçe
        </Label>
        <Input
          id={`district-${candidate.id}`}
          name="proposedDistrict"
          defaultValue={candidate.proposedDistrict}
          required
        />
      </div>
      <label className="flex h-9 items-center gap-2 text-sm">
        <input
          type="checkbox"
          name="proposedIsActive"
          defaultChecked={candidate.proposedIsActive}
          className="size-4"
        />
        Aktif
      </label>
      <SubmitButton variant="outline" size="sm" pendingText="Kaydediliyor...">
        Düzenle ve Kaydet
      </SubmitButton>
    </form>
  );
}

function CandidatePanel({
  candidate,
  regions,
}: {
  candidate: CandidateForReview;
  regions: RegionOption[];
}) {
  const decided =
    candidate.status === "MATCHED_EXISTING_ACTIVE" ||
    candidate.status === "EXCLUDED_BY_ADMIN" ||
    candidate.approvedAt !== null;

  return (
    <div className="flex flex-col gap-3 rounded-lg border p-4" data-testid="region-candidate">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">{candidate.sourceValue || "(boş değer)"}</span>
        <Badge variant="secondary">Kaynak: {SOURCE_LABELS[candidate.sourceType] ?? "?"}</Badge>
        <Badge variant={statusVariant(candidate)}>
          {STATUS_LABELS[candidate.status] ?? candidate.status}
          {candidate.approvedAt &&
          candidate.status !== "MATCHED_EXISTING_ACTIVE" &&
          candidate.status !== "EXCLUDED_BY_ADMIN"
            ? " — Onaylandı"
            : ""}
        </Badge>
        <span className="text-muted-foreground text-sm">
          {candidate.rowCount} eczane satırında kullanılıyor
        </span>
      </div>

      {candidate.matchedRegion && (
        <p className="text-sm">
          Eşleşen mevcut bölge: <span className="font-medium">{candidate.matchedRegion.name}</span>{" "}
          {candidate.matchedRegion.isActive ? (
            <Badge variant="success">Aktif</Badge>
          ) : (
            <Badge variant="destructive">Pasif</Badge>
          )}
        </p>
      )}

      {candidate.status === "MATCHED_EXISTING_INACTIVE" && !candidate.approvedAt && (
        <p className="text-destructive text-sm">
          Bu aday pasif bir bölgeyle eşleşiyor. İçe aktarım öncesi karar verin: bölge pasif kalsın
          (eczaneler pasif bölgeye aktarılır ve bölge aktifleştirilene kadar yeni çizelgelere
          katılmaz) veya bölge yeniden aktifleştirilsin.
        </p>
      )}
      {candidate.status === "MATCHED_EXISTING_INACTIVE" && candidate.approvedAt && (
        <p className="text-sm">
          Karar: {candidate.reactivateOnImport ? "bölge içe aktarımda yeniden aktifleştirilecek" : "bölge pasif kalacak"}.
        </p>
      )}
      {candidate.status === "ADDRESS_SUGGESTION" && (
        <p className="text-muted-foreground text-sm">
          Bu değer adresten türetilen bir öneridir; onaylanmadan hiçbir bölge oluşturulmaz veya
          eşleştirilmez.
        </p>
      )}
      {candidate.status === "NEW_REGION_CANDIDATE" && candidate.approvedAt && (
        <p className="text-sm">
          Yeni bölge olarak onaylandı: <span className="font-medium">{candidate.proposedName}</span>{" "}
          ({candidate.proposedCity} / {candidate.proposedDistrict},{" "}
          {candidate.proposedIsActive ? "aktif" : "pasif"} oluşturulacak).
        </p>
      )}

      {!decided && candidate.status !== "MATCHED_EXISTING_INACTIVE" && (
        <EditForm candidate={candidate} />
      )}

      <div className="flex flex-wrap items-end gap-2">
        {candidate.status === "MATCHED_EXISTING_INACTIVE" && !candidate.approvedAt && (
          <>
            <form action={approveRegionCandidateAction.bind(null, candidate.id)}>
              <input type="hidden" name="mode" value="keep-inactive" />
              <SubmitButton variant="outline" size="sm" pendingText="Kaydediliyor...">
                Pasif Bırak ve Kullan
              </SubmitButton>
            </form>
            <form action={approveRegionCandidateAction.bind(null, candidate.id)}>
              <input type="hidden" name="mode" value="reactivate" />
              <SubmitButton variant="outline" size="sm" pendingText="Kaydediliyor...">
                Yeniden Aktifleştir
              </SubmitButton>
            </form>
          </>
        )}

        {!decided &&
          (candidate.status === "NEW_REGION_CANDIDATE" ||
            candidate.status === "AMBIGUOUS" ||
            candidate.status === "UNRESOLVED") && (
            <form action={approveRegionCandidateAction.bind(null, candidate.id)}>
              <SubmitButton size="sm" pendingText="Onaylanıyor...">
                Yeni Bölge Olarak Onayla
              </SubmitButton>
            </form>
          )}

        {candidate.status === "ADDRESS_SUGGESTION" && (
          <>
            <form action={approveRegionCandidateAction.bind(null, candidate.id)}>
              <SubmitButton size="sm" pendingText="Onaylanıyor...">
                Öneriyi Kabul Et
              </SubmitButton>
            </form>
            <form action={resetRegionCandidateAction.bind(null, candidate.id)}>
              <input type="hidden" name="mode" value="reject-suggestion" />
              <SubmitButton variant="outline" size="sm" pendingText="Reddediliyor...">
                Öneriyi Reddet
              </SubmitButton>
            </form>
          </>
        )}

        {!decided && candidate.status !== "EXCLUDED_BY_ADMIN" && (
          <MatchExistingForm candidate={candidate} regions={regions} />
        )}

        {decided && (
          <form action={resetRegionCandidateAction.bind(null, candidate.id)}>
            <SubmitButton variant="outline" size="sm" pendingText="Geri alınıyor...">
              Kararı Geri Al
            </SubmitButton>
          </form>
        )}

        {candidate.status !== "EXCLUDED_BY_ADMIN" && (
          <form action={excludeRegionCandidateAction.bind(null, candidate.id)}>
            <SubmitButton variant="ghost" size="sm" pendingText="Çıkarılıyor...">
              İçe Aktarım Dışında Bırak
            </SubmitButton>
          </form>
        )}
      </div>
    </div>
  );
}

export function CandidateReviewSection({
  batchId,
  candidates,
  regions,
  editable,
}: {
  batchId: string;
  candidates: CandidateForReview[];
  regions: RegionOption[];
  editable: boolean;
}) {
  return (
    <div className="flex flex-col gap-4">
      {candidates.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          Bu dosyada karar bekleyen bölge adayı yok.
        </p>
      ) : (
        candidates.map((candidate) => (
          <CandidatePanel key={candidate.id} candidate={candidate} regions={regions} />
        ))
      )}

      {editable && (
        <div className="rounded-lg border border-dashed p-4">
          <h3 className="mb-3 text-sm font-semibold">Manuel Yeni Bölge Tanımla</h3>
          <form
            action={createManualRegionCandidateAction.bind(null, batchId)}
            className="flex flex-wrap items-end gap-2"
          >
            <div className="w-44">
              <Label htmlFor="manual-name" className="text-xs">
                Bölge Adı
              </Label>
              <Input id="manual-name" name="proposedName" required />
            </div>
            <div className="w-36">
              <Label htmlFor="manual-city" className="text-xs">
                İl
              </Label>
              <Input id="manual-city" name="proposedCity" required />
            </div>
            <div className="w-36">
              <Label htmlFor="manual-district" className="text-xs">
                İlçe
              </Label>
              <Input id="manual-district" name="proposedDistrict" required />
            </div>
            <label className="flex h-9 items-center gap-2 text-sm">
              <input type="checkbox" name="proposedIsActive" defaultChecked className="size-4" />
              Aktif
            </label>
            <SubmitButton variant="outline" size="sm" pendingText="Oluşturuluyor...">
              Bölge Adayı Oluştur
            </SubmitButton>
          </form>
          <p className="text-muted-foreground mt-2 text-xs">
            Bu bölge, içe aktarım onaylanana kadar yalnızca bir aday olarak saklanır; gerçek bölge
            kaydı ancak içe aktarımla birlikte oluşturulur.
          </p>
        </div>
      )}
    </div>
  );
}
