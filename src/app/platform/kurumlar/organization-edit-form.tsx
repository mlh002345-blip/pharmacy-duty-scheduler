"use client";

import { useActionState } from "react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FieldError } from "@/components/ui/field-error";
import { type ActionState, initialActionState, fieldError } from "@/lib/action-state";

type EditableOrganization = {
  id: string;
  name: string;
  province: string;
  slug: string;
};

type OrganizationFormAction = (state: ActionState, formData: FormData) => Promise<ActionState>;

export function OrganizationEditForm({
  action,
  organization,
}: {
  action: OrganizationFormAction;
  organization: EditableOrganization;
}) {
  const [state, formAction, isPending] = useActionState(action, initialActionState);

  return (
    <form action={formAction} className="flex max-w-lg flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="name">Oda Adı</Label>
        <Input id="name" name="name" defaultValue={organization.name} required />
        <FieldError message={fieldError(state, "name")} />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="province">İl / Bölge</Label>
        <Input id="province" name="province" defaultValue={organization.province} required />
        <FieldError message={fieldError(state, "province")} />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="slug">Kısa Ad (slug)</Label>
        <Input id="slug" name="slug" defaultValue={organization.slug} />
        <FieldError message={fieldError(state, "slug")} />
      </div>

      {!state.success && state.message && (
        <p className="text-destructive text-sm">{state.message}</p>
      )}

      <div className="flex gap-2">
        <Button type="submit" disabled={isPending}>
          Kaydet
        </Button>
        <Button type="button" variant="outline" asChild>
          <Link href={`/platform/kurumlar/${organization.id}`}>İptal</Link>
        </Button>
      </div>
    </form>
  );
}
