"use client";

import { useActionState } from "react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FieldError } from "@/components/ui/field-error";
import { initialActionState, fieldError } from "@/lib/action-state";
import { requestPasswordResetAction } from "./actions";

export function RequestPasswordResetForm() {
  const [state, formAction, isPending] = useActionState(
    requestPasswordResetAction,
    initialActionState
  );

  if (state.success && state.message) {
    return (
      <div className="flex flex-col gap-4">
        <p className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">
          {state.message}
        </p>
        <Link href="/giris" className="text-primary text-sm font-medium underline-offset-2 hover:underline">
          Giriş ekranına dön
        </Link>
      </div>
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="email">E-posta</Label>
        <Input id="email" name="email" type="email" autoComplete="email" required />
        <FieldError message={fieldError(state, "email")} />
      </div>

      {!state.success && state.message && (
        <p className="text-destructive text-sm">{state.message}</p>
      )}

      <Button type="submit" disabled={isPending} className="w-full">
        {isPending ? "Gönderiliyor..." : "Sıfırlama Bağlantısı Gönder"}
      </Button>

      <Link href="/giris" className="text-muted-foreground text-center text-sm underline-offset-2 hover:underline">
        Giriş ekranına dön
      </Link>
    </form>
  );
}
