"use client";

import { useActionState } from "react";
import { AlertTriangle, CheckCircle2, FileUp } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { historicalImportAction } from "./actions";
import {
  initialImportState,
  PREVIEW_DISPLAY_LIMIT,
  type ImportActionState,
} from "./import-state";

const STATUS_LABELS: Record<string, string> = {
  OK: "Uygun",
  WARNING: "Uyarı",
  ERROR: "Hata",
};

function PreviewTable({ preview }: { preview: NonNullable<ImportActionState["preview"]> }) {
  const displayedRows = preview.rows.slice(0, PREVIEW_DISPLAY_LIMIT);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2 text-sm">
        <Badge variant="secondary">{preview.totalCount} satır</Badge>
        <Badge variant="success">{preview.okCount} uygun</Badge>
        <Badge variant="warning">{preview.warningCount} uyarılı</Badge>
        <Badge variant={preview.errorCount > 0 ? "destructive" : "secondary"}>
          {preview.errorCount} hatalı
        </Badge>
        <Badge variant="info">{preview.matchedCount} eşleşen eczane</Badge>
      </div>
      {preview.rows.length > PREVIEW_DISPLAY_LIMIT && (
        <p className="text-muted-foreground text-xs">
          İlk {PREVIEW_DISPLAY_LIMIT} satır gösteriliyor; analiz tüm satırları kapsar.
        </p>
      )}
      <div className="max-h-96 overflow-y-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Satır</TableHead>
              <TableHead>Tarih</TableHead>
              <TableHead>Eczane Adı</TableHead>
              <TableHead>Eşleşen Eczane</TableHead>
              <TableHead>Bölge</TableHead>
              <TableHead>Nöbet Türü</TableHead>
              <TableHead>Hesaplanan Puan</TableHead>
              <TableHead>Durum</TableHead>
              <TableHead>Uyarı/Hata</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {displayedRows.map((row) => (
              <TableRow key={row.rowNumber}>
                <TableCell>{row.rowNumber}</TableCell>
                <TableCell>{row.rawDate || "-"}</TableCell>
                <TableCell className="font-medium">{row.rawPharmacyName || "-"}</TableCell>
                <TableCell>{row.matchedPharmacyName ?? "-"}</TableCell>
                <TableCell>{row.regionName ?? "-"}</TableCell>
                <TableCell>{row.dutyType || "-"}</TableCell>
                <TableCell>{row.weight}</TableCell>
                <TableCell>
                  <Badge
                    variant={
                      row.status === "OK"
                        ? "success"
                        : row.status === "WARNING"
                          ? "warning"
                          : "destructive"
                    }
                  >
                    {STATUS_LABELS[row.status]}
                  </Badge>
                </TableCell>
                <TableCell className="max-w-[280px]">
                  <span
                    className="text-muted-foreground block truncate text-xs"
                    title={row.messages.join(" ")}
                  >
                    {row.messages.join(" ") || "-"}
                  </span>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

export function HistoricalImportForm() {
  const [state, formAction, isPending] = useActionState(
    historicalImportAction,
    initialImportState
  );

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="file">Excel Dosyası (.xlsx)</Label>
        <Input
          id="file"
          name="file"
          type="file"
          accept=".xlsx,.xls"
          required
          className="max-w-md cursor-pointer"
        />
        <p className="text-muted-foreground text-xs">
          Beklenen sütunlar: Tarih, Bölge, Eczane Adı, Nöbet Türü, Telefon, Adres, Not.
          Zorunlu olanlar: Tarih ve Eczane Adı.
        </p>
      </div>

      {state.message && (
        <div
          className={
            state.success
              ? "flex items-start gap-2 rounded-md border border-emerald-500/50 bg-emerald-500/10 px-4 py-2 text-sm text-emerald-700"
              : "border-destructive/50 bg-destructive/10 text-destructive flex items-start gap-2 rounded-md border px-4 py-2 text-sm"
          }
        >
          {state.success ? (
            <CheckCircle2 className="mt-0.5 size-4 shrink-0" />
          ) : (
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          )}
          {state.message}
        </div>
      )}

      {state.preview && <PreviewTable preview={state.preview} />}

      <div className="flex flex-wrap gap-2">
        <Button
          type="submit"
          name="mode"
          value="preview"
          variant="secondary"
          disabled={isPending}
        >
          <FileUp className="size-4" />
          {isPending ? "Analiz ediliyor..." : "Önizle ve Kontrol Et"}
        </Button>
        {state.preview?.canImport && (
          <Button
            type="submit"
            name="mode"
            value="import"
            disabled={isPending}
            onClick={(e) => {
              if (
                !confirm(
                  `${state.preview?.totalCount} satır içe aktarılacak (${state.preview?.matchedCount} eşleşen kayıt denge skoruna dahil edilecek). Onaylıyor musunuz?`
                )
              ) {
                e.preventDefault();
              }
            }}
          >
            {isPending ? "İçe aktarılıyor..." : "İçe Aktarımı Onayla"}
          </Button>
        )}
      </div>
      <p className="text-muted-foreground text-xs">
        Not: Önizlemeden sonra aynı dosya seçiliyken &quot;İçe Aktarımı Onayla&quot;
        butonuna basın; sistem içe aktarmadan önce dosyayı yeniden doğrular. Geçmiş
        kayıtlar hiçbir zaman yeni nöbet ataması oluşturmaz; yalnızca denge skorunu
        etkiler. Eşleşmeyen kayıtlar saklanır ancak denge skoruna katılmaz.
      </p>
    </form>
  );
}
