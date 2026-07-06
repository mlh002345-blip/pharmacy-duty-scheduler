"use client";

import { useActionState } from "react";
import Link from "next/link";
import type { Unavailability, Pharmacy, Region } from "@prisma/client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { FieldError } from "@/components/ui/field-error";
import { type ActionState, initialActionState, fieldError } from "@/lib/action-state";

type UnavailabilityAction = (
  state: ActionState,
  formData: FormData
) => Promise<ActionState>;

type PharmacyWithRegion = Pharmacy & { region: Region };

export function UnavailabilityForm({
  action,
  unavailability,
  pharmacies,
}: {
  action: UnavailabilityAction;
  unavailability?: Unavailability;
  pharmacies: PharmacyWithRegion[];
}) {
  const [state, formAction, isPending] = useActionState(action, initialActionState);

  const pharmaciesByRegion = new Map<string, PharmacyWithRegion[]>();
  for (const pharmacy of pharmacies) {
    const list = pharmaciesByRegion.get(pharmacy.region.name) ?? [];
    list.push(pharmacy);
    pharmaciesByRegion.set(pharmacy.region.name, list);
  }

  const defaultStartDate = unavailability
    ? unavailability.startDate.toISOString().slice(0, 10)
    : "";
  const defaultEndDate = unavailability
    ? unavailability.endDate.toISOString().slice(0, 10)
    : "";

  return (
    <form action={formAction} className="flex max-w-lg flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="pharmacyId">Eczane</Label>
        <Select
          id="pharmacyId"
          name="pharmacyId"
          defaultValue={unavailability?.pharmacyId}
          required
        >
          <option value="">Seçiniz</option>
          {Array.from(pharmaciesByRegion.entries()).map(([regionName, list]) => (
            <optgroup key={regionName} label={regionName}>
              {list.map((pharmacy) => (
                <option key={pharmacy.id} value={pharmacy.id}>
                  {pharmacy.name} — {pharmacy.pharmacistName}
                </option>
              ))}
            </optgroup>
          ))}
        </Select>
        <FieldError message={fieldError(state, "pharmacyId")} />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="startDate">Başlangıç Tarihi</Label>
          <Input
            id="startDate"
            name="startDate"
            type="date"
            defaultValue={defaultStartDate}
            required
          />
          <FieldError message={fieldError(state, "startDate")} />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="endDate">Bitiş Tarihi</Label>
          <Input
            id="endDate"
            name="endDate"
            type="date"
            defaultValue={defaultEndDate}
            required
          />
          <FieldError message={fieldError(state, "endDate")} />
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="reason">Açıklama (opsiyonel)</Label>
        <Input id="reason" name="reason" defaultValue={unavailability?.reason ?? ""} />
        <FieldError message={fieldError(state, "reason")} />
      </div>

      {!state.success && state.message && (
        <p className="text-destructive text-sm">{state.message}</p>
      )}

      <div className="flex gap-2">
        <Button type="submit" disabled={isPending}>
          Kaydet
        </Button>
        <Button type="button" variant="outline" asChild>
          <Link href="/mazeretler">İptal</Link>
        </Button>
      </div>
    </form>
  );
}
