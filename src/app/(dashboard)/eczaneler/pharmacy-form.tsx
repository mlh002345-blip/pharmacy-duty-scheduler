"use client";

import { useActionState } from "react";
import Link from "next/link";
import type { Pharmacy, Region } from "@prisma/client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { FieldError } from "@/components/ui/field-error";
import { type ActionState, initialActionState, fieldError } from "@/lib/action-state";

type PharmacyAction = (state: ActionState, formData: FormData) => Promise<ActionState>;

export function PharmacyForm({
  action,
  pharmacy,
  regions,
}: {
  action: PharmacyAction;
  pharmacy?: Pharmacy;
  regions: Region[];
}) {
  const [state, formAction, isPending] = useActionState(action, initialActionState);

  return (
    <form action={formAction} className="flex max-w-2xl flex-col gap-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="name">Eczane Adı</Label>
          <Input id="name" name="name" defaultValue={pharmacy?.name} required />
          <FieldError message={fieldError(state, "name")} />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="pharmacistName">Eczacı Adı</Label>
          <Input
            id="pharmacistName"
            name="pharmacistName"
            defaultValue={pharmacy?.pharmacistName}
            required
          />
          <FieldError message={fieldError(state, "pharmacistName")} />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="phone">Telefon</Label>
          <Input id="phone" name="phone" defaultValue={pharmacy?.phone} required />
          <FieldError message={fieldError(state, "phone")} />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="regionId">Nöbet Bölgesi</Label>
          <Select id="regionId" name="regionId" defaultValue={pharmacy?.regionId} required>
            <option value="">Seçiniz</option>
            {regions.map((region) => (
              <option key={region.id} value={region.id}>
                {region.name}
              </option>
            ))}
          </Select>
          <FieldError message={fieldError(state, "regionId")} />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="city">İl</Label>
          <Input id="city" name="city" defaultValue={pharmacy?.city} required />
          <FieldError message={fieldError(state, "city")} />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="district">İlçe</Label>
          <Input id="district" name="district" defaultValue={pharmacy?.district} required />
          <FieldError message={fieldError(state, "district")} />
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="address">Adres</Label>
        <Input id="address" name="address" defaultValue={pharmacy?.address} required />
        <FieldError message={fieldError(state, "address")} />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="mapUrl">Harita Bağlantısı (opsiyonel)</Label>
        <Input
          id="mapUrl"
          name="mapUrl"
          type="url"
          placeholder="https://maps.google.com/..."
          defaultValue={pharmacy?.mapUrl ?? ""}
        />
        <FieldError message={fieldError(state, "mapUrl")} />
      </div>

      <div className="flex items-center gap-2">
        <input
          id="isActive"
          name="isActive"
          type="checkbox"
          defaultChecked={pharmacy?.isActive ?? true}
          className="size-4"
        />
        <Label htmlFor="isActive">Aktif</Label>
      </div>

      {!state.success && state.message && (
        <p className="text-destructive text-sm">{state.message}</p>
      )}

      <div className="flex gap-2">
        <Button type="submit" disabled={isPending}>
          Kaydet
        </Button>
        <Button type="button" variant="outline" asChild>
          <Link href="/eczaneler">İptal</Link>
        </Button>
      </div>
    </form>
  );
}
