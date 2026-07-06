import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

const ACCENTS = {
  green: "bg-emerald-50 text-emerald-700",
  navy: "bg-slate-100 text-slate-700",
  amber: "bg-amber-50 text-amber-700",
  sky: "bg-sky-50 text-sky-700",
} as const;

export function StatCard({
  label,
  value,
  icon: Icon,
  accent = "green",
  hint,
}: {
  label: string;
  value: React.ReactNode;
  icon: LucideIcon;
  accent?: keyof typeof ACCENTS;
  hint?: string;
}) {
  return (
    <div className="bg-card hover-lift flex items-start gap-4 rounded-xl border p-5 shadow-sm">
      <div
        className={cn(
          "flex size-11 shrink-0 items-center justify-center rounded-xl",
          ACCENTS[accent]
        )}
      >
        <Icon className="size-5" />
      </div>
      <div className="min-w-0">
        <p className="text-muted-foreground text-sm font-medium">{label}</p>
        <p className="mt-1 truncate text-2xl font-semibold tracking-tight">{value}</p>
        {hint && <p className="text-muted-foreground mt-0.5 truncate text-xs">{hint}</p>}
      </div>
    </div>
  );
}
