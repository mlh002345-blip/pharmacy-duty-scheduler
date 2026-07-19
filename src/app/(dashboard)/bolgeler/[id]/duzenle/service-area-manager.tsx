"use client";

import { useActionState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FieldError } from "@/components/ui/field-error";
import { DeleteButton } from "@/components/layout/delete-button";
import { initialActionState, fieldError } from "@/lib/action-state";
import { createServiceAreaAction, deleteServiceAreaAction } from "../../service-area-actions";

export function ServiceAreaManager({
  regionId,
  serviceAreas,
}: {
  regionId: string;
  serviceAreas: { id: string; name: string; pharmacyCount: number }[];
}) {
  const [state, formAction, isPending] = useActionState(
    createServiceAreaAction.bind(null, regionId),
    initialActionState
  );

  return (
    <div className="flex flex-col gap-4">
      {serviceAreas.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          Bu bölgede henüz bir hizmet alanı tanımlanmadı.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {serviceAreas.map((area) => (
            <li
              key={area.id}
              className="flex items-center justify-between gap-4 rounded-md border px-3 py-2"
            >
              <div>
                <span className="text-sm font-medium">{area.name}</span>
                <span className="text-muted-foreground ml-2 text-xs">
                  {area.pharmacyCount} eczane
                </span>
              </div>
              <DeleteButton
                action={deleteServiceAreaAction.bind(null, regionId, area.id)}
                confirmMessage={`"${area.name}" hizmet alanını silmek istediğinize emin misiniz? Etiketli eczaneler silinmez, yalnızca etiketleri kalkar.`}
              />
            </li>
          ))}
        </ul>
      )}

      <form action={formAction} className="flex items-end gap-2">
        <div className="flex flex-1 flex-col gap-1.5">
          <Label htmlFor="serviceAreaName">Yeni Hizmet Alanı Adı</Label>
          <Input
            id="serviceAreaName"
            name="name"
            placeholder="Örn. Üniversite Yakını"
            required
          />
          <FieldError message={fieldError(state, "name")} />
        </div>
        <Button type="submit" disabled={isPending}>
          Ekle
        </Button>
      </form>

      {!state.success && state.message && (
        <p role="alert" className="text-destructive text-sm">
          {state.message}
        </p>
      )}
      {state.success && state.message && (
        <p className="text-sm text-emerald-700">{state.message}</p>
      )}
    </div>
  );
}
