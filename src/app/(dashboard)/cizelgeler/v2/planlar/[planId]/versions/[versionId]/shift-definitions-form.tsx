"use client";

import { useActionState, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { updateShiftDefinitionsAction } from "./actions";
import { initialActionState } from "@/lib/action-state";

type ShiftRow = {
  id?: string;
  name: string;
  startMinute: number;
  endMinute: number;
  spansMidnight: boolean;
  defaultWeight: number;
  sortOrder: number;
};

function minutesToHHMM(minutes: number): string {
  const h = Math.floor(minutes / 60)
    .toString()
    .padStart(2, "0");
  const m = (minutes % 60).toString().padStart(2, "0");
  return `${h}:${m}`;
}

function hhmmToMinutes(value: string): number {
  const [h, m] = value.split(":").map((n) => Number(n));
  return (h || 0) * 60 + (m || 0);
}

export function ShiftDefinitionsForm({
  planId,
  versionId,
  initialShifts,
}: {
  planId: string;
  versionId: string;
  initialShifts: ShiftRow[];
}) {
  const action = updateShiftDefinitionsAction.bind(null, planId, versionId);
  const [state, formAction, isPending] = useActionState(action, initialActionState);
  const [shifts, setShifts] = useState<ShiftRow[]>(initialShifts);

  function updateRow(index: number, patch: Partial<ShiftRow>) {
    setShifts((prev) => prev.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }

  function addRow() {
    setShifts((prev) => [
      ...prev,
      { name: "", startMinute: 0, endMinute: 0, spansMidnight: false, defaultWeight: 1, sortOrder: prev.length },
    ]);
  }

  function addDailyShift() {
    setShifts((prev) => [
      ...prev,
      {
        name: "Günlük Nöbet",
        startMinute: 0,
        endMinute: 1439,
        spansMidnight: false,
        defaultWeight: 1,
        sortOrder: prev.length,
      },
    ]);
  }

  function removeRow(index: number) {
    setShifts((prev) => prev.filter((_, i) => i !== index));
  }

  const shiftsJson = JSON.stringify(shifts);

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <input type="hidden" name="shiftsJson" value={shiftsJson} />
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Ad</TableHead>
            <TableHead>Başlangıç</TableHead>
            <TableHead>Bitiş</TableHead>
            <TableHead>Gece Yarısını Aşar</TableHead>
            <TableHead>Ağırlık</TableHead>
            <TableHead>Sıra</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {shifts.map((shift, index) => (
            <TableRow key={index}>
              <TableCell>
                <Input
                  value={shift.name}
                  onChange={(e) => updateRow(index, { name: e.target.value })}
                  className="h-8 w-40"
                />
              </TableCell>
              <TableCell>
                <Input
                  type="time"
                  value={minutesToHHMM(shift.startMinute)}
                  onChange={(e) => updateRow(index, { startMinute: hhmmToMinutes(e.target.value) })}
                  className="h-8 w-28"
                />
              </TableCell>
              <TableCell>
                <Input
                  type="time"
                  value={minutesToHHMM(shift.endMinute)}
                  onChange={(e) => updateRow(index, { endMinute: hhmmToMinutes(e.target.value) })}
                  className="h-8 w-28"
                />
              </TableCell>
              <TableCell>
                <input
                  type="checkbox"
                  checked={shift.spansMidnight}
                  onChange={(e) => updateRow(index, { spansMidnight: e.target.checked })}
                />
              </TableCell>
              <TableCell>
                <Input
                  type="number"
                  step="0.1"
                  min="0.1"
                  value={shift.defaultWeight}
                  onChange={(e) => updateRow(index, { defaultWeight: Number(e.target.value) })}
                  className="h-8 w-20"
                />
              </TableCell>
              <TableCell>
                <Input
                  type="number"
                  value={shift.sortOrder}
                  onChange={(e) => updateRow(index, { sortOrder: Number(e.target.value) })}
                  className="h-8 w-16"
                />
              </TableCell>
              <TableCell>
                <Button type="button" variant="ghost" size="sm" onClick={() => removeRow(index)}>
                  Kaldır
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      <div className="flex gap-2">
        <Button type="button" variant="outline" size="sm" onClick={addRow}>
          Vardiya Ekle
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={addDailyShift}>
          Günlük Nöbet Ekle (00:00–23:59)
        </Button>
      </div>

      {!state.success && state.message && (
        <p role="alert" className="text-destructive text-sm">
          {state.message}
        </p>
      )}
      {state.success && state.message && <p className="text-sm text-emerald-700">{state.message}</p>}
      <div>
        <Button type="submit" size="sm" disabled={isPending}>
          {isPending ? "Kaydediliyor..." : "Vardiyaları Kaydet"}
        </Button>
      </div>
    </form>
  );
}
