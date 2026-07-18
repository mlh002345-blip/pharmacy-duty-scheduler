"use client";

import { useActionState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { updatePlanVersionPolicyAction } from "./actions";
import { initialActionState } from "@/lib/action-state";

export type PlanVersionPolicyInitial = {
  minDaysBetweenDuties: number | null;
  relaxMinIntervalWhenInsufficient: boolean;
  sameDaySecondAssignmentAllowed: boolean;
  holidayEveWeightSource: "CONFIGURED" | "UNDERLYING_WEEKDAY";
  holidayOverlapResolutionMode: "NATIVE_PRECEDENCE" | "V1_LAST_INPUT_WINS";
};

export function PolicyForm({
  planId,
  versionId,
  initialPolicy,
}: {
  planId: string;
  versionId: string;
  initialPolicy: PlanVersionPolicyInitial;
}) {
  const action = updatePlanVersionPolicyAction.bind(null, planId, versionId);
  const [state, formAction, isPending] = useActionState(action, initialActionState);

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <label className="text-sm font-medium" htmlFor="minDaysBetweenDuties">
          Asgari Nöbet Aralığı (gün)
        </label>
        <Input
          id="minDaysBetweenDuties"
          name="minDaysBetweenDuties"
          type="number"
          min="0"
          step="1"
          className="w-40"
          defaultValue={
            initialPolicy.minDaysBetweenDuties === null
              ? ""
              : String(initialPolicy.minDaysBetweenDuties)
          }
          placeholder="Yapılandırılmadı"
        />
        <p className="text-muted-foreground text-xs">
          Boş bırakılırsa bu sürüm V1 uyumluluk modunda çalışmaya devam eder.
        </p>
      </div>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          name="relaxMinIntervalWhenInsufficient"
          defaultChecked={initialPolicy.relaxMinIntervalWhenInsufficient}
        />
        Yetersiz eczane olduğunda asgari aralığı gevşet
      </label>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          name="sameDaySecondAssignmentAllowed"
          defaultChecked={initialPolicy.sameDaySecondAssignmentAllowed}
        />
        Aynı gün ikinci atamaya izin ver
      </label>

      <div className="flex flex-col gap-1">
        <label className="text-sm font-medium" htmlFor="holidayEveWeightSource">
          Bayram Arifesi Ağırlık Kaynağı
        </label>
        <Select
          id="holidayEveWeightSource"
          name="holidayEveWeightSource"
          className="w-72"
          defaultValue={initialPolicy.holidayEveWeightSource}
        >
          <option value="CONFIGURED">Yapılandırılmış değer kullan</option>
          <option value="UNDERLYING_WEEKDAY">
            Arifenin denk geldiği haftaiçi/haftasonu ağırlığını kullan
          </option>
        </Select>
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-sm font-medium" htmlFor="holidayOverlapResolutionMode">
          Bayram Çakışması Çözüm Modu
        </label>
        <Select
          id="holidayOverlapResolutionMode"
          name="holidayOverlapResolutionMode"
          className="w-72"
          defaultValue={initialPolicy.holidayOverlapResolutionMode}
        >
          <option value="NATIVE_PRECEDENCE">Dini bayram resmi bayrama önceliklidir</option>
          <option value="V1_LAST_INPUT_WINS">Son girilen bayram kazanır (V1 uyumlu)</option>
        </Select>
      </div>

      {!state.success && state.message && (
        <p role="alert" className="text-destructive text-sm">
          {state.message}
        </p>
      )}
      {state.success && state.message && <p className="text-sm text-emerald-700">{state.message}</p>}
      <div>
        <Button type="submit" size="sm" disabled={isPending}>
          {isPending ? "Kaydediliyor..." : "Politikayı Kaydet"}
        </Button>
      </div>
    </form>
  );
}
