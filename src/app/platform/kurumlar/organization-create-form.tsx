"use client";

import { useActionState } from "react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FieldError } from "@/components/ui/field-error";
import { initialActionState, fieldError } from "@/lib/action-state";
import { createOrganizationAction } from "./actions";

export function OrganizationCreateForm() {
  const [state, formAction, isPending] = useActionState(
    createOrganizationAction,
    initialActionState
  );

  return (
    <form action={formAction} className="flex max-w-lg flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="name">Oda Adı</Label>
        <Input id="name" name="name" required />
        <FieldError message={fieldError(state, "name")} />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="province">İl / Bölge</Label>
        <Input id="province" name="province" required />
        <FieldError message={fieldError(state, "province")} />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="slug">Kısa Ad (slug)</Label>
        <Input id="slug" name="slug" placeholder="Boş bırakılırsa oda adından otomatik oluşturulur" />
        <FieldError message={fieldError(state, "slug")} />
      </div>

      <div className="flex items-center gap-2">
        <input id="isActive" name="isActive" type="checkbox" defaultChecked className="size-4" />
        <Label htmlFor="isActive">Aktif</Label>
      </div>
      <FieldError message={fieldError(state, "isActive")} />

      <div className="border-border mt-2 border-t pt-4">
        <p className="text-sm font-medium">İlk Yönetici Hesabı</p>
        <p className="text-muted-foreground text-xs">
          Bu oda için oluşturulacak ilk ADMIN rolündeki kullanıcı.
        </p>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="adminName">Yönetici Ad Soyad</Label>
        <Input id="adminName" name="adminName" required />
        <FieldError message={fieldError(state, "adminName")} />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="adminEmail">Yönetici E-posta</Label>
        <Input id="adminEmail" name="adminEmail" type="email" required />
        <FieldError message={fieldError(state, "adminEmail")} />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="adminPassword">Geçici Şifre</Label>
        <Input id="adminPassword" name="adminPassword" type="password" required />
        <FieldError message={fieldError(state, "adminPassword")} />
      </div>

      {!state.success && state.message && (
        <p className="text-destructive text-sm">{state.message}</p>
      )}

      <div className="flex gap-2">
        <Button type="submit" disabled={isPending}>
          Oda Oluştur
        </Button>
        <Button type="button" variant="outline" asChild>
          <Link href="/platform/kurumlar">İptal</Link>
        </Button>
      </div>
    </form>
  );
}
