"use client";

import { useActionState, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { updateSlotRequirementsAction } from "./actions";
import { initialActionState } from "@/lib/action-state";
import type { BuiltinDayType } from "@/lib/duty-rules-v2/domain/loaded-plan";

const DAY_TYPE_LABELS: Record<BuiltinDayType, string> = {
  WEEKDAY: "Hafta İçi",
  SATURDAY: "Cumartesi",
  SUNDAY: "Pazar",
  OFFICIAL_HOLIDAY: "Resmi Bayram",
  RELIGIOUS_HOLIDAY: "Dini Bayram",
  HOLIDAY_EVE: "Bayram Arifesi",
};

type SlotRow = {
  id?: string;
  name?: string | null;
  dayTypeRuleId: string;
  shiftDefinitionId: string;
  rotationPoolId: string | null;
  requiredCount: number;
  sortOrder: number;
};

export function SlotRequirementsForm({
  planId,
  versionId,
  initialSlots,
  dayTypeRules,
  shifts,
  pools,
}: {
  planId: string;
  versionId: string;
  initialSlots: SlotRow[];
  dayTypeRules: { id: string; dayType: BuiltinDayType }[];
  shifts: { id: string; name: string }[];
  pools: { id: string; name: string }[];
}) {
  const action = updateSlotRequirementsAction.bind(null, planId, versionId);
  const [state, formAction, isPending] = useActionState(action, initialActionState);
  const [slots, setSlots] = useState<SlotRow[]>(initialSlots);

  function updateRow(index: number, patch: Partial<SlotRow>) {
    setSlots((prev) => prev.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }

  function addRow() {
    setSlots((prev) => [
      ...prev,
      {
        dayTypeRuleId: dayTypeRules[0]?.id ?? "",
        shiftDefinitionId: shifts[0]?.id ?? "",
        rotationPoolId: null,
        requiredCount: 1,
        sortOrder: prev.length,
      },
    ]);
  }

  function removeRow(index: number) {
    setSlots((prev) => prev.filter((_, i) => i !== index));
  }

  const slotsJson = JSON.stringify(slots);

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <input type="hidden" name="slotsJson" value={slotsJson} />
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Gün Tipi</TableHead>
            <TableHead>Vardiya</TableHead>
            <TableHead>Rotasyon Havuzu</TableHead>
            <TableHead>Gereken Sayı</TableHead>
            <TableHead>Sıra</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {slots.map((slot, index) => (
            <TableRow key={index}>
              <TableCell>
                <Select
                  value={slot.dayTypeRuleId}
                  onChange={(e) => updateRow(index, { dayTypeRuleId: e.target.value })}
                  className="h-8 w-36"
                >
                  {dayTypeRules.map((rule) => (
                    <option key={rule.id} value={rule.id}>
                      {DAY_TYPE_LABELS[rule.dayType]}
                    </option>
                  ))}
                </Select>
              </TableCell>
              <TableCell>
                <Select
                  value={slot.shiftDefinitionId}
                  onChange={(e) => updateRow(index, { shiftDefinitionId: e.target.value })}
                  className="h-8 w-36"
                >
                  {shifts.map((shift) => (
                    <option key={shift.id} value={shift.id}>
                      {shift.name}
                    </option>
                  ))}
                </Select>
              </TableCell>
              <TableCell>
                <Select
                  value={slot.rotationPoolId ?? ""}
                  onChange={(e) => updateRow(index, { rotationPoolId: e.target.value || null })}
                  className="h-8 w-40"
                >
                  <option value="">Varsayılan (havuz yok)</option>
                  {pools.map((pool) => (
                    <option key={pool.id} value={pool.id}>
                      {pool.name}
                    </option>
                  ))}
                </Select>
              </TableCell>
              <TableCell>
                <Input
                  type="number"
                  min="1"
                  value={slot.requiredCount}
                  onChange={(e) => updateRow(index, { requiredCount: Number(e.target.value) })}
                  className="h-8 w-20"
                />
              </TableCell>
              <TableCell>
                <Input
                  type="number"
                  value={slot.sortOrder}
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

      <div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={addRow}
          disabled={dayTypeRules.length === 0 || shifts.length === 0}
        >
          Slot Ekle
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
          {isPending ? "Kaydediliyor..." : "Slot Gereksinimlerini Kaydet"}
        </Button>
      </div>
    </form>
  );
}
