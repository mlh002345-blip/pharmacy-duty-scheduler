"use client";

import { useActionState } from "react";
import { FileUp } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FieldError } from "@/components/ui/field-error";
import { initialActionState, fieldError } from "@/lib/action-state";
import { previewPharmacyImportAction } from "./actions";

export function ImportUploadForm() {
  const [state, formAction, isPending] = useActionState(
    previewPharmacyImportAction,
    initialActionState
  );

  return (
    <form action={formAction} className="flex max-w-lg flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="file">Excel Dosyası (.xlsx)</Label>
        <Input
          id="file"
          name="file"
          type="file"
          accept=".xlsx"
          required
          className="cursor-pointer"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="defaultAreaCode">Varsayılan Alan Kodu (opsiyonel)</Label>
        <Input
          id="defaultAreaCode"
          name="defaultAreaCode"
          placeholder="ör. 228"
          maxLength={3}
          className="max-w-32"
        />
        <p className="text-muted-foreground text-xs">
          Dosyada 7 haneli (alan kodsuz) telefon numarası varsa kullanılır. Girilmezse bu
          tür numaralar aktarılamaz.
        </p>
        <FieldError message={fieldError(state, "defaultAreaCode")} />
      </div>

      {!state.success && state.message && (
        <p className="text-destructive text-sm">{state.message}</p>
      )}

      <div>
        <Button type="submit" disabled={isPending}>
          <FileUp className="size-4" />
          {isPending ? "Analiz ediliyor..." : "Önizle ve Doğrula"}
        </Button>
      </div>
    </form>
  );
}
