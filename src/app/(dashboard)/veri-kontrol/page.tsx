import Link from "next/link";
import {
  AlertTriangle,
  AlertOctagon,
  CheckCircle2,
  Info,
  ShieldCheck,
  ArrowRight,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { StatCard } from "@/components/layout/stat-card";
import { PageHeader } from "@/components/layout/page-header";
import { getDataHealthReport, type HealthFinding } from "@/lib/health/data-health";
import { requireOrganizationMember } from "@/lib/auth/tenant";

export const dynamic = "force-dynamic";

function FindingList({
  findings,
  emptyMessage,
}: {
  findings: HealthFinding[];
  emptyMessage: string;
}) {
  if (findings.length === 0) {
    return (
      <div className="flex items-center gap-2.5 rounded-lg border border-dashed px-4 py-6 text-center text-sm">
        <CheckCircle2 className="mx-auto size-4.5 text-emerald-600" />
        <span className="text-muted-foreground">{emptyMessage}</span>
      </div>
    );
  }

  return (
    <ul className="flex flex-col gap-2">
      {findings.map((finding, index) => (
        <li
          key={`${finding.message}-${index}`}
          className="flex flex-wrap items-center justify-between gap-2 rounded-lg border px-4 py-3 text-sm"
        >
          <div className="min-w-0">
            <p className="font-medium">{finding.message}</p>
            {finding.affected && (
              <p className="text-muted-foreground mt-0.5 text-xs">{finding.affected}</p>
            )}
          </div>
          {finding.linkHref && (
            <Link
              href={finding.linkHref}
              className="text-primary inline-flex shrink-0 items-center gap-1 text-xs font-medium underline-offset-4 hover:underline"
            >
              {finding.linkLabel ?? "Görüntüle"} <ArrowRight className="size-3" />
            </Link>
          )}
        </li>
      ))}
    </ul>
  );
}

export default async function VeriKontrolPage() {
  const user = await requireOrganizationMember();
  const report = await getDataHealthReport(user.organizationId);
  const now = new Date();

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Veri Sağlık Kontrolü"
        description="Çizelge oluşturmadan önce bölge, eczane, kural, talep ve geçmiş nöbet verilerinin tutarlılığını kontrol edin."
        icon={ShieldCheck}
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Kritik Hata"
          value={report.critical.length}
          icon={AlertOctagon}
          accent={report.critical.length > 0 ? "amber" : "green"}
        />
        <StatCard
          label="Uyarı"
          value={report.warnings.length}
          icon={AlertTriangle}
          accent="amber"
        />
        <StatCard label="Bilgilendirme" value={report.info.length} icon={Info} accent="sky" />
        <StatCard
          label="Son Kontrol"
          value={now.toLocaleDateString("tr-TR")}
          hint={now.toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" })}
          icon={ShieldCheck}
          accent="navy"
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <AlertOctagon className="size-4.5 text-destructive" />
            Kritik Hatalar
            <Badge variant={report.critical.length > 0 ? "destructive" : "success"}>
              {report.critical.length}
            </Badge>
          </CardTitle>
          <CardDescription>
            Çizelge oluşturma başarısız olabilir veya geçersiz sonuç üretebilir.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <FindingList
            findings={report.critical}
            emptyMessage="Kritik hata bulunmuyor."
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <AlertTriangle className="size-4.5 text-amber-600" />
            Uyarılar
            <Badge variant={report.warnings.length > 0 ? "warning" : "success"}>
              {report.warnings.length}
            </Badge>
          </CardTitle>
          <CardDescription>Sistem çalışır ancak verilerin gözden geçirilmesi önerilir.</CardDescription>
        </CardHeader>
        <CardContent>
          <FindingList findings={report.warnings} emptyMessage="Uyarı bulunmuyor." />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Info className="size-4.5 text-sky-600" />
            Bilgilendirme
            <Badge variant="info">{report.info.length}</Badge>
          </CardTitle>
          <CardDescription>Operasyonel durum hakkında faydalı bilgiler.</CardDescription>
        </CardHeader>
        <CardContent>
          <FindingList findings={report.info} emptyMessage="Bilgilendirme bulunmuyor." />
        </CardContent>
      </Card>
    </div>
  );
}
