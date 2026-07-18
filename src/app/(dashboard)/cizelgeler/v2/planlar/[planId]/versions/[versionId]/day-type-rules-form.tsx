"use client";

import { useActionState, useState } from "react";

import { Button } from "@/components/ui/button";
import { updateDayTypeRulesAction } from "./actions";
import { initialActionState } from "@/lib/action-state";
import { BUILTIN_DAY_TYPES, type BuiltinDayType } from "@/lib/duty-rules-v2/domain/loaded-plan";

const DAY_TYPE_LABELS: Record<BuiltinDayType, string> = {
  WEEKDAY: "Hafta İçi",
  SATURDAY: "Cumartesi",
  SUNDAY: "Pazar",
  OFFICIAL_HOLIDAY: "Resmi Bayram",
  RELIGIOUS_HOLIDAY: "Dini Bayram",
  HOLIDAY_EVE: "Bayram Arifesi",
};

export function DayTypeRulesForm({
  planId,
  versionId,
  initialRules,
}: {
  planId: string;
  versionId: string;
  initialRules: { dayType: BuiltinDayType; isServed: boolean; weight: number | null }[];
}) {
  const action = updateDayTypeRulesAction.bind(null, planId, versionId);
  const [state, formAction, isPending] = useActionState(action, initialActionState);

  const [served, setServed] = useState<Record<BuiltinDayType, boolean>>(() => {
    const map = Object.fromEntries(BUILTIN_DAY_TYPES.map((dt) => [dt, false])) as Record<
      BuiltinDayType,
      boolean
    >;
    for (const rule of initialRules) {
      map[rule.dayType] = rule.isServed;
    }
    return map;
  });

  const [weights, setWeights] = useState<Record<BuiltinDayType, string>>(() => {
    const map = Object.fromEntries(BUILTIN_DAY_TYPES.map((dt) => [dt, ""])) as Record<
      BuiltinDayType,
      string
    >;
    for (const rule of initialRules) {
      map[rule.dayType] = rule.weight === null ? "" : String(rule.weight);
    }
    return map;
  });

  const rulesJson = JSON.stringify(
    BUILTIN_DAY_TYPES.map((dayType) => ({
      dayType,
      isServed: served[dayType],
      weight: weights[dayType] === "" ? null : Number(weights[dayType]),
    }))
  );

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <input type="hidden" name="rulesJson" value={rulesJson} />
      <div className="flex flex-col gap-2">
        {BUILTIN_DAY_TYPES.map((dayType) => (
          <div key={dayType} data-testid={`day-type-row-${dayType}`} className="flex items-center gap-3 text-sm">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={served[dayType]}
                onChange={(e) => setServed((prev) => ({ ...prev, [dayType]: e.target.checked }))}
              />
              {DAY_TYPE_LABELS[dayType]}
            </label>
            <label
              className={`flex items-center gap-1 ${served[dayType] ? "" : "text-muted-foreground"}`}
            >
              Ağırlık
              <input
                type="number"
                step="0.01"
                min="0"
                value={weights[dayType]}
                disabled={!served[dayType]}
                onChange={(e) =>
                  setWeights((prev) => ({ ...prev, [dayType]: e.target.value }))
                }
                className="border-input bg-background w-24 rounded border px-2 py-1 text-sm disabled:opacity-50"
              />
            </label>
          </div>
        ))}
      </div>
      {!state.success && state.message && (
        <p role="alert" className="text-destructive text-sm">
          {state.message}
        </p>
      )}
      {state.success && state.message && <p className="text-sm text-emerald-700">{state.message}</p>}
      <div>
        <Button type="submit" size="sm" disabled={isPending}>
          {isPending ? "Kaydediliyor..." : "Gün Tiplerini Kaydet"}
        </Button>
      </div>
    </form>
  );
}
