import { AlertOctagon, AlertTriangle, CheckCircle2, Info, ShieldCheck } from "lucide-react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/layout/page-header";
import { StatCard } from "@/components/layout/stat-card";
import { runDataHealthChecks, type HealthCheckItem } from "@/lib/health/data-health";

export const dynamic = "force-dynamic";

function CheckGroup({
  title,
  description,
  items,
  tone,
}: {
  title: string;
  description: string;
  items: HealthCheckItem[];
  tone: "critical" | "warning" | "info";
}) {
  const toneStyles = {
    critical: {
      border: "border-red-300/60",
      bg: "bg-red-50",
      text: "text-red-900",
      subtext: "text-red-800/80",
      icon: <AlertOctagon className="size-5 shrink-0 text-red-600" />,
    },
    warning: {
      border: "border-amber-300/60",
      bg: "bg-amber-50",
      text: "text-amber-900",
      subtext: "text-amber-800/80",
      icon: <AlertTriangle className="size-5 shrink-0 text-amber-600" />,
    },
    info: {
      border: "border-sky-300/60",
      bg: "bg-sky-50",
      text: "text-sky-900",
      subtext: "text-sky-800/80",
      icon: <Info className="size-5 shrink-0 text-sky-600" />,
    },
  }[tone];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          {toneStyles.icon}
          {title}
          <span className="text-muted-foreground text-sm font-normal">
            ({items.length})
          </span>
        </CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        {items.length === 0 ? (
          <p className="flex items-center gap-2 text-sm text-emerald-700">
            <CheckCircle2 className="size-4" />
            Bu kategoride sorun bulunmadı.
          </p>
        ) : (
          <ul className="flex flex-col gap-3">
            {items.map((item, index) => (
              <li
                key={index}
                className={`rounded-xl border ${toneStyles.border} ${toneStyles.bg} px-4 py-3`}
              >
                <p className={`text-sm font-medium ${toneStyles.text}`}>{item.title}</p>
                {item.details.length > 0 && (
                  <ul className={`mt-1.5 flex flex-col gap-0.5 text-xs ${toneStyles.subtext}`}>
                    {item.details.map((detail, detailIndex) => (
                      <li key={detailIndex}>• {detail}</li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

export default async function VeriKontrolPage() {
  const report = await runDataHealthChecks();

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Veri Sağlık Kontrolü"
        description="Çizelge oluşturmadan önce bölge, eczane, kural ve veri tutarlılığını kontrol edin."
        icon={ShieldCheck}
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard
          label="Kritik Hata"
          value={report.critical.length}
          icon={AlertOctagon}
          accent={report.critical.length > 0 ? "amber" : "green"}
          hint={report.critical.length > 0 ? "Çizelge oluşturmayı engelleyebilir" : "Sorun yok"}
        />
        <StatCard
          label="Uyarı"
          value={report.warnings.length}
          icon={AlertTriangle}
          accent={report.warnings.length > 0 ? "amber" : "green"}
        />
        <StatCard label="Bilgilendirme" value={report.info.length} icon={Info} accent="sky" />
      </div>

      <CheckGroup
        title="Kritik Hatalar"
        description="Bu sorunlar giderilmeden ilgili bölgelerde çizelge oluşturulamaz."
        items={report.critical}
        tone="critical"
      />
      <CheckGroup
        title="Uyarılar"
        description="Çizelge oluşturulabilir ancak bu konuların gözden geçirilmesi önerilir."
        items={report.warnings}
        tone="warning"
      />
      <CheckGroup
        title="Bilgilendirme"
        description="Genel durum özeti ve isteğe bağlı iyileştirmeler."
        items={report.info}
        tone="info"
      />
    </div>
  );
}
