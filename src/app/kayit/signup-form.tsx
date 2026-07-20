"use client";

import { useActionState } from "react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FieldError } from "@/components/ui/field-error";
import { initialActionState, fieldError } from "@/lib/action-state";
import { createSelfServiceOrganizationAction } from "./actions";

export function SelfServiceSignupForm() {
  const [state, formAction, isPending] = useActionState(
    createSelfServiceOrganizationAction,
    initialActionState
  );

  return (
    <form action={formAction} className="flex flex-col gap-4">
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

      <div className="border-border mt-2 border-t pt-4">
        <p className="text-sm font-medium">Yönetici Hesabınız</p>
        <p className="text-muted-foreground text-xs">
          Odanız için oluşturulacak ilk Yönetici hesabı — sisteme bu bilgilerle giriş yapacaksınız.
        </p>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="adminName">Ad Soyad</Label>
        <Input id="adminName" name="adminName" required />
        <FieldError message={fieldError(state, "adminName")} />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="adminEmail">E-posta</Label>
        <Input id="adminEmail" name="adminEmail" type="email" autoComplete="email" required />
        <FieldError message={fieldError(state, "adminEmail")} />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="adminPassword">Şifre</Label>
        <Input
          id="adminPassword"
          name="adminPassword"
          type="password"
          autoComplete="new-password"
          required
        />
        <FieldError message={fieldError(state, "adminPassword")} />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="adminPasswordConfirmation">Şifre (Tekrar)</Label>
        <Input
          id="adminPasswordConfirmation"
          name="adminPasswordConfirmation"
          type="password"
          autoComplete="new-password"
          required
        />
        <FieldError message={fieldError(state, "adminPasswordConfirmation")} />
      </div>

      <div className="flex items-start gap-2 pt-1">
        <input
          id="termsAccepted"
          name="termsAccepted"
          type="checkbox"
          required
          className="mt-0.5 size-4"
        />
        <Label htmlFor="termsAccepted" className="text-muted-foreground text-xs leading-relaxed font-normal">
          <Link href="/gizlilik-politikasi" target="_blank" className="text-primary underline-offset-2 hover:underline">
            KVKK Aydınlatma Metni
          </Link>
          {"'ni ve "}
          <Link href="/kullanim-sartlari" target="_blank" className="text-primary underline-offset-2 hover:underline">
            Kullanım Şartları
          </Link>
          {"'nı okudum, kabul ediyorum."}
        </Label>
      </div>
      <FieldError message={fieldError(state, "termsAccepted")} />

      {!state.success && state.message && (
        <p className="text-destructive text-sm">{state.message}</p>
      )}

      <Button type="submit" disabled={isPending} className="w-full">
        {isPending ? "Oluşturuluyor..." : "Hesap Oluştur"}
      </Button>

      <Link href="/giris" className="text-muted-foreground text-center text-sm underline-offset-2 hover:underline">
        Zaten hesabınız var mı? Giriş yapın
      </Link>
    </form>
  );
}
