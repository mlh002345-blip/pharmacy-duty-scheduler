"use client";

import { useActionState } from "react";
import Link from "next/link";
import type { UserRole } from "@prisma/client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { FieldError } from "@/components/ui/field-error";
import { ROLE_LABELS } from "@/lib/auth/permissions";
import { USER_ROLE_VALUES } from "@/lib/validations/user";
import { type ActionState, initialActionState, fieldError } from "@/lib/action-state";

type UserFormAction = (state: ActionState, formData: FormData) => Promise<ActionState>;

// Sadece formun ihtiyaç duyduğu alanlar: passwordHash gibi hassas alanları
// içeren Prisma User tipi yerine bilerek dar bir DTO kullanılıyor, böylece
// bu Client Component'e sunucu tarafından yanlışlıkla şifre özeti geçirilemez.
export type EditableUser = {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  isActive: boolean;
};

export function UserForm({
  action,
  user,
}: {
  action: UserFormAction;
  user?: EditableUser;
}) {
  const [state, formAction, isPending] = useActionState(action, initialActionState);
  const isEdit = !!user;

  return (
    <form action={formAction} className="flex max-w-lg flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="name">Ad Soyad</Label>
        <Input id="name" name="name" defaultValue={user?.name} required />
        <FieldError message={fieldError(state, "name")} />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="email">E-posta</Label>
        <Input id="email" name="email" type="email" defaultValue={user?.email} required />
        <FieldError message={fieldError(state, "email")} />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="role">Rol</Label>
        <Select id="role" name="role" defaultValue={user?.role ?? "VIEWER"} required>
          {USER_ROLE_VALUES.map((role) => (
            <option key={role} value={role}>
              {ROLE_LABELS[role]}
            </option>
          ))}
        </Select>
        <FieldError message={fieldError(state, "role")} />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="password">{isEdit ? "Yeni Şifre (opsiyonel)" : "Şifre"}</Label>
        <Input id="password" name="password" type="password" required={!isEdit} />
        <FieldError message={fieldError(state, "password")} />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="passwordConfirmation">
          {isEdit ? "Yeni Şifre Tekrarı" : "Şifre Tekrarı"}
        </Label>
        <Input
          id="passwordConfirmation"
          name="passwordConfirmation"
          type="password"
          required={!isEdit}
        />
        <FieldError message={fieldError(state, "passwordConfirmation")} />
      </div>

      <div className="flex items-center gap-2">
        <input
          id="isActive"
          name="isActive"
          type="checkbox"
          defaultChecked={user?.isActive ?? true}
          className="size-4"
        />
        <Label htmlFor="isActive">Aktif</Label>
      </div>
      <FieldError message={fieldError(state, "isActive")} />

      {!state.success && state.message && (
        <p className="text-destructive text-sm">{state.message}</p>
      )}

      <div className="flex gap-2">
        <Button type="submit" disabled={isPending}>
          Kaydet
        </Button>
        <Button type="button" variant="outline" asChild>
          <Link href="/kullanicilar">İptal</Link>
        </Button>
      </div>
    </form>
  );
}
