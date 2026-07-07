"use client";

import { useActionState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { FieldError } from "@/components/ui/field-error";
import { initialActionState, fieldError } from "@/lib/action-state";
import { createDutyRequestAction } from "./actions";

const REQUEST_TYPE_OPTIONS = [
  { value: "CANNOT_DUTY", label: "Nöbet Tutamama" },
  { value: "PREFER_DUTY", label: "Nöbet Tercihi" },
  { value: "SWAP_REQUEST", label: "Nöbet Değişimi" },
  { value: "EMERGENCY_EXCUSE", label: "Acil Mazeret" },
];

export function DutyRequestForm({
  pharmacies,
  canApproveDirectly,
}: {
  pharmacies: { id: string; name: string; regionName: string }[];
  canApproveDirectly: boolean;
}) {
  const [state, formAction, isPending] = useActionState(
    createDutyRequestAction,
    initialActionState
  );

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="pharmacyId">Eczane</Label>
          <Select id="pharmacyId" name="pharmacyId" defaultValue="" required>
            <option value="">Seçiniz</option>
            {pharmacies.map((pharmacy) => (
              <option key={pharmacy.id} value={pharmacy.id}>
                {pharmacy.name} ({pharmacy.regionName})
              </option>
            ))}
          </Select>
          <FieldError message={fieldError(state, "pharmacyId")} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="requestType">Talep Türü</Label>
          <Select id="requestType" name="requestType" defaultValue="CANNOT_DUTY" required>
            {REQUEST_TYPE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
          <FieldError message={fieldError(state, "requestType")} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="startDate">Başlangıç Tarihi</Label>
          <Input id="startDate" name="startDate" type="date" required />
          <FieldError message={fieldError(state, "startDate")} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="endDate">Bitiş Tarihi</Label>
          <Input id="endDate" name="endDate" type="date" required />
          <FieldError message={fieldError(state, "endDate")} />
        </div>
        <div className="flex flex-col gap-1.5 sm:col-span-2">
          <Label htmlFor="explanation">Açıklama</Label>
          <Textarea
            id="explanation"
            name="explanation"
            placeholder="Örn: Yıllık izin nedeniyle bu tarihlerde nöbet tutamayacağım."
            required
          />
          <FieldError message={fieldError(state, "explanation")} />
        </div>
      </div>

      {canApproveDirectly && (
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="approveNow" value="true" className="size-4" />
          Talebi doğrudan onaylı olarak oluştur (inceleme adımı atlanır)
        </label>
      )}

      {!state.success && state.message && (
        <p className="text-destructive text-sm">{state.message}</p>
      )}

      <div>
        <Button type="submit" disabled={isPending}>
          {isPending ? "Kaydediliyor..." : "Talep Oluştur"}
        </Button>
      </div>
    </form>
  );
}
