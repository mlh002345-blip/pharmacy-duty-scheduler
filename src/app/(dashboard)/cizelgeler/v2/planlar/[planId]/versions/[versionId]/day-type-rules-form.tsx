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
  initialRules: { dayType: BuiltinDayType; isServed: boolean }[];
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

  const rulesJson = JSON.stringify(
    BUILTIN_DAY_TYPES.map((dayType) => ({ dayType, isServed: served[dayType] }))
  );

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <input type="hidden" name="rulesJson" value={rulesJson} />
      <div className="flex flex-col gap-2">
        {BUILTIN_DAY_TYPES.map((dayType) => (
          <label key={dayType} className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={served[dayType]}
              onChange={(e) => setServed((prev) => ({ ...prev, [dayType]: e.target.checked }))}
            />
            {DAY_TYPE_LABELS[dayType]}
          </label>
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
