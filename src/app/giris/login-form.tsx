"use client";

import { useActionState } from "react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FieldError } from "@/components/ui/field-error";
import { loginAction } from "@/lib/auth/actions";
import { initialActionState, fieldError } from "@/lib/action-state";

export function LoginForm() {
  const [state, formAction, isPending] = useActionState(loginAction, initialActionState);

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="email">E-posta</Label>
        <Input id="email" name="email" type="email" autoComplete="email" required />
        <FieldError message={fieldError(state, "email")} />
      </div>

      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between">
          <Label htmlFor="password">Şifre</Label>
          <Link
            href="/sifremi-unuttum"
            className="text-primary text-xs font-medium underline-offset-2 hover:underline"
          >
            Şifremi unuttum
          </Link>
        </div>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
        />
        <FieldError message={fieldError(state, "password")} />
      </div>

      {!state.success && state.message && (
        <p className="text-destructive text-sm">{state.message}</p>
      )}

      <Button type="submit" disabled={isPending} className="w-full">
        {isPending ? "Giriş yapılıyor..." : "Giriş Yap"}
      </Button>

      <Link
        href="/kayit"
        className="text-muted-foreground text-center text-sm underline-offset-2 hover:underline"
      >
        Odanız için hesap oluşturun
      </Link>
    </form>
  );
}
