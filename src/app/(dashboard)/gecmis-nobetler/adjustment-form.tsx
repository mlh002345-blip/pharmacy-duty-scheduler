"use client";

import { useActionState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { FieldError } from "@/components/ui/field-error";
import { initialActionState, fieldError } from "@/lib/action-state";
import { createBalanceAdjustmentAction } from "./actions";

export function BalanceAdjustmentForm({
  pharmacies,
}: {
  pharmacies: { id: string; name: string; regionName: string }[];
}) {
  const [state, formAction, isPending] = useActionState(
    createBalanceAdjustmentAction,
    initialActionState
  );

  return (
    <form
      action={formAction}
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        const form = e.currentTarget;
        const points = (form.elements.namedItem("points") as HTMLInputElement)?.value;
        if (!confirm(`${points} puanlık manuel denge düzeltmesi eklenecek. Onaylıyor musunuz?`)) {
          e.preventDefault();
        }
      }}
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
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
          <Label htmlFor="points">Puan</Label>
          <Input
            id="points"
            name="points"
            type="number"
            step="0.1"
            placeholder="Örn: 5 veya -3"
            required
          />
          <FieldError message={fieldError(state, "points")} />
        </div>
        <div className="flex flex-col gap-1.5 sm:col-span-3">
          <Label htmlFor="reason">Gerekçe</Label>
          <Input
            id="reason"
            name="reason"
            placeholder='Örn: "2024 öncesi kayıtlar sisteme aktarılamadığı için +5 başlangıç yükü eklendi."'
            required
          />
          <FieldError message={fieldError(state, "reason")} />
        </div>
      </div>

      {!state.success && state.message && (
        <p className="text-destructive text-sm">{state.message}</p>
      )}

      <div>
        <Button type="submit" disabled={isPending}>
          {isPending ? "Kaydediliyor..." : "Denge Düzeltmesi Ekle"}
        </Button>
      </div>
    </form>
  );
}
