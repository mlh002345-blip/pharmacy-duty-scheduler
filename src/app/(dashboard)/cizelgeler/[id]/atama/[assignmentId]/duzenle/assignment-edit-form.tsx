"use client";

import { useActionState, useState } from "react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { FieldError } from "@/components/ui/field-error";
import { fieldError } from "@/lib/action-state";
import {
  type EditAssignmentActionState,
  initialEditAssignmentState,
} from "../../assignment-action-state";

type EditAssignmentAction = (
  state: EditAssignmentActionState,
  formData: FormData
) => Promise<EditAssignmentActionState>;

export function AssignmentEditForm({
  action,
  scheduleId,
  currentPharmacyId,
  candidatePharmacies,
}: {
  action: EditAssignmentAction;
  scheduleId: string;
  currentPharmacyId: string;
  candidatePharmacies: { id: string; name: string; pharmacistName: string }[];
}) {
  const [state, formAction, isPending] = useActionState(
    action,
    initialEditAssignmentState
  );

  // Controlled so the user's choices survive the extra round-trip when a
  // minDaysBetweenDuties warning appears and they need to confirm/resubmit.
  const [pharmacyId, setPharmacyId] = useState(currentPharmacyId);
  const [reason, setReason] = useState("");
  const [confirmOverride, setConfirmOverride] = useState(false);

  return (
    <form action={formAction} className="flex max-w-lg flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="pharmacyId">Yeni Nöbetçi Eczane</Label>
        <Select
          id="pharmacyId"
          name="pharmacyId"
          value={pharmacyId}
          onChange={(e) => setPharmacyId(e.target.value)}
          required
        >
          {candidatePharmacies.map((pharmacy) => (
            <option key={pharmacy.id} value={pharmacy.id}>
              {pharmacy.name} — {pharmacy.pharmacistName}
            </option>
          ))}
        </Select>
        <FieldError message={fieldError(state, "pharmacyId")} />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="reason">Değişiklik Nedeni</Label>
        <Input
          id="reason"
          name="reason"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          required
        />
        <FieldError message={fieldError(state, "reason")} />
      </div>

      {!state.success && state.message && !state.requiresConfirmation && (
        <p className="text-destructive text-sm">{state.message}</p>
      )}

      {state.requiresConfirmation && (
        <div className="border-destructive/50 bg-destructive/10 flex flex-col gap-2 rounded-md border p-3 text-sm">
          <p className="text-destructive">{state.warning}</p>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              name="confirmOverride"
              value="true"
              checked={confirmOverride}
              onChange={(e) => setConfirmOverride(e.target.checked)}
              className="size-4"
            />
            Uyarıyı onaylıyorum, yine de kaydet.
          </label>
        </div>
      )}

      <div className="flex gap-2">
        <Button type="submit" disabled={isPending}>
          {isPending ? "Kaydediliyor..." : "Kaydet"}
        </Button>
        <Button type="button" variant="outline" asChild>
          <Link href={`/cizelgeler/${scheduleId}`}>İptal</Link>
        </Button>
      </div>
    </form>
  );
}
