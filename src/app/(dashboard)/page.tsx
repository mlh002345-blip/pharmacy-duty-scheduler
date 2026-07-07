import Link from "next/link";
import {
  AlertTriangle,
  ArrowRight,
  Building2,
  CalendarCheck,
  CalendarRange,
  CheckCircle2,
  Circle,
  Cross,
  FileClock,
  Globe,
  MapPin,
  PencilLine,
  Plus,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { StatCard } from "@/components/layout/stat-card";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth/session";
import { hasPermission } from "@/lib/auth/permissions";
import { getTurkishMonthName, todayAtUtcMidnight } from "@/lib/scheduling/date-tr";
import { DUTY_SCHEDULE_STATUS_LABELS } from "@/lib/scheduling/duty-schedule-labels";

export const dynamic = "force-dynamic";

export default async function PanelPage() {
  const user = await getCurrentUser();
  const canGenerate = !!user && hasPermission(user.role, "generateSchedule");
  const canManage = !!user && hasPermission(user.role, "manageSetupData");

  const today = todayAtUtcMidnight();

  const [
    pharmacyCount,
    activePharmacyCount,
    activeRegionCount,
    dutyRuleCount,
    holidayCount,
    draftScheduleCount,
    publishedScheduleCount,
    matchedHistoricalCount,
    pendingRequestCount,
    regionsWithoutRuleCount,
    todayDuty,
    lastManualChange,
    recentSchedules,
  ] = await Promise.all([
    prisma.pharmacy.count(),
    prisma.pharmacy.count({ where: { isActive: true } }),
    prisma.region.count({ where: { isActive: true } }),
    prisma.dutyRule.count(),
    prisma.holiday.count(),
    prisma.dutySchedule.count({ where: { status: "DRAFT" } }),
    prisma.dutySchedule.count({ where: { status: "PUBLISHED" } }),
    prisma.historicalDutyRecord.count({ where: { matchStatus: "MATCHED" } }),
    prisma.dutyRequest.count({ where: { status: "PENDING" } }),
    prisma.region.count({ where: { isActive: true, dutyRule: { is: null } } }),
    prisma.dutyAssignment.findFirst({
      where: { date: today, dutySchedule: { status: "PUBLISHED" } },
      select: {
        pharmacy: { select: { name: true } },
        dutySchedule: { select: { region: { select: { name: true } } } },
      },
      orderBy: { dutySchedule: { region: { name: "asc" } } },
    }),
    prisma.auditLog.findFirst({
      where: { entity: "DutyAssignment" },
      select: { createdAt: true, user: { select: { name: true } } },
      orderBy: { createdAt: "desc" },
    }),
    prisma.dutySchedule.findMany({
      select: {
        id: true,
        month: true,
        year: true,
        status: true,
        region: { select: { name: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 4,
    }),
  ]);

  const todayLabel = new Date().toLocaleDateString("tr-TR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  type ChecklistState = "done" | "missing" | "warning";
  const checklist: { label: string; state: ChecklistState; href: string; hint?: string }[] = [
    {
      label: "Nöbet bölgeleri tanımlandı",
      state: activeRegionCount > 0 ? "done" : "missing",
      href: "/bolgeler",
    },
    {
      label: "Eczaneler kaydedildi",
      state: pharmacyCount > 0 ? "done" : "missing",
      href: "/eczaneler",
    },
    {
      label: "Nöbet kuralları tanımlandı",
      state:
        dutyRuleCount === 0 ? "missing" : regionsWithoutRuleCount > 0 ? "warning" : "done",
      href: "/kurallar",
      hint: regionsWithoutRuleCount > 0 ? `${regionsWithoutRuleCount} bölgede kural eksik` : undefined,
    },
    {
      label: "Tatil günleri yüklendi",
      state: holidayCount > 0 ? "done" : "missing",
      href: "/tatil-gunleri",
    },
    {
      label: "Geçmiş nöbetler aktarıldı",
      state: matchedHistoricalCount > 0 ? "done" : "warning",
      href: "/gecmis-nobetler",
      hint: matchedHistoricalCount === 0 ? "Denge skoru sıfırdan başlar" : undefined,
    },
    {
      label: "Nöbet talepleri incelendi",
      state: pendingRequestCount > 0 ? "warning" : "done",
      href: "/nobet-talepleri",
      hint: pendingRequestCount > 0 ? `${pendingRequestCount} bekleyen talep` : undefined,
    },
    {
      label: "Veri kontrolü yapıldı",
      state: regionsWithoutRuleCount > 0 ? "warning" : "done",
      href: "/veri-kontrol",
    },
    {
      label: "İlk çizelge oluşturuldu",
      state: draftScheduleCount + publishedScheduleCount > 0 ? "done" : "missing",
      href: "/cizelgeler",
    },
    {
      label: "Vatandaş ekranında yayında çizelge var",
      state: publishedScheduleCount > 0 ? "done" : "missing",
      href: "/cizelgeler",
    },
  ];
  const completedSteps = checklist.filter((item) => item.state === "done").length;

  const quickActions = [
    ...(canGenerate
      ? [
          {
            label: "Yeni Nöbet Çizelgesi",
            description: "Bölge ve ay seçerek otomatik çizelge oluşturun",
            href: "/cizelgeler/yeni",
            icon: Plus,
            featured: true,
          },
        ]
      : []),
    {
      label: "Nöbet Çizelgeleri",
      description: "Taslak ve yayındaki çizelgeleri yönetin",
      href: "/cizelgeler",
      icon: CalendarRange,
      featured: false,
    },
    ...(canManage
      ? [
          {
            label: "Eczaneler",
            description: "Eczane kayıtlarını görüntüleyin ve düzenleyin",
            href: "/eczaneler",
            icon: Building2,
            featured: false,
          },
        ]
      : []),
    {
      label: "Vatandaş Ekranı",
      description: "Vatandaşların gördüğü nöbet ekranını açın",
      href: "/vatandas",
      icon: Globe,
      featured: false,
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      {/* Karşılama başlığı */}
      <div className="from-navy relative overflow-hidden rounded-2xl bg-gradient-to-br to-[oklch(0.34_0.05_230)] p-6 text-white shadow-lg sm:p-8">
        <div
          aria-hidden
          className="absolute inset-0"
          style={{
            background:
              "radial-gradient(60% 100% at 85% 20%, oklch(0.55 0.11 163 / 0.4) 0%, transparent 60%)",
          }}
        />
        <div className="relative z-10 flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-sm text-white/60 first-letter:uppercase">{todayLabel}</p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight">
              Hoş geldiniz{user ? `, ${user.name}` : ""}
            </h1>
            <p className="mt-1 text-sm text-white/70">
              Nöbet çizelgeleme sisteminin genel durumuna buradan göz atabilirsiniz.
            </p>
          </div>
          <div className="flex items-center gap-2 rounded-full bg-white/10 px-3.5 py-1.5 text-sm backdrop-blur">
            <span
              className={`size-2 rounded-full ${publishedScheduleCount > 0 ? "bg-emerald-400" : "bg-amber-400"}`}
            />
            {publishedScheduleCount > 0
              ? "Vatandaş ekranı yayında"
              : "Yayınlanmış çizelge bekleniyor"}
          </div>
        </div>
      </div>

      {/* Metrik kartları */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Toplam Eczane"
          value={pharmacyCount}
          hint={`${activePharmacyCount} aktif`}
          icon={Building2}
          accent="green"
        />
        <StatCard label="Aktif Bölge" value={activeRegionCount} icon={MapPin} accent="navy" />
        <StatCard
          label="Yayındaki Çizelge"
          value={publishedScheduleCount}
          icon={CalendarCheck}
          accent="sky"
        />
        <StatCard
          label="Taslak Çizelge"
          value={draftScheduleCount}
          hint={draftScheduleCount > 0 ? "Yayınlanmayı bekliyor" : undefined}
          icon={FileClock}
          accent="amber"
        />
      </div>

      {/* Bugünün nöbetçisi + son manuel değişiklik */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="hover-lift relative overflow-hidden rounded-xl border bg-gradient-to-br from-emerald-600 to-emerald-800 p-5 text-white shadow-sm">
          <Cross
            aria-hidden
            className="absolute -right-4 -bottom-6 size-32 text-white/10"
            strokeWidth={1}
          />
          <p className="text-sm font-medium text-white/70">Bugünün Nöbetçi Eczanesi</p>
          {todayDuty ? (
            <>
              <p className="mt-1.5 text-xl font-semibold tracking-tight">
                {todayDuty.pharmacy.name}
              </p>
              <p className="mt-0.5 text-sm text-white/70">
                {todayDuty.dutySchedule.region.name} bölgesi
              </p>
            </>
          ) : (
            <p className="mt-1.5 text-sm text-white/80">
              Bugün için yayımlanmış nöbet ataması bulunmuyor.
            </p>
          )}
          <Link
            href="/vatandas"
            className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-white underline-offset-4 hover:underline"
          >
            Vatandaş ekranında görüntüle <ArrowRight className="size-3.5" />
          </Link>
        </div>

        <div className="hover-lift rounded-xl border bg-card p-5 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-700">
              <PencilLine className="size-5" />
            </div>
            <p className="text-muted-foreground text-sm font-medium">Son Manuel Değişiklik</p>
          </div>
          {lastManualChange ? (
            <>
              <p className="mt-3 font-medium">
                {lastManualChange.createdAt.toLocaleString("tr-TR", {
                  day: "numeric",
                  month: "long",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </p>
              <p className="text-muted-foreground mt-0.5 text-sm">
                {lastManualChange.user.name} tarafından nöbet ataması güncellendi.
              </p>
            </>
          ) : (
            <p className="text-muted-foreground mt-3 text-sm">
              Henüz manuel bir atama değişikliği yapılmadı.
            </p>
          )}
          <Link
            href="/denetim-kayitlari"
            className="text-primary mt-3 inline-flex items-center gap-1.5 text-sm font-medium underline-offset-4 hover:underline"
          >
            Denetim kayıtlarını aç <ArrowRight className="size-3.5" />
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
        {/* Hızlı işlemler */}
        <Card className="lg:col-span-3">
          <CardHeader>
            <CardTitle>Hızlı İşlemler</CardTitle>
            <CardDescription>Sık kullanılan işlemlere tek tıkla ulaşın.</CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {quickActions.map((action) => (
              <Link
                key={action.href + action.label}
                href={action.href}
                className={
                  action.featured
                    ? "hover-lift group flex items-start gap-3 rounded-xl bg-primary p-4 text-primary-foreground shadow-sm"
                    : "hover-lift group flex items-start gap-3 rounded-xl border p-4"
                }
              >
                <span
                  className={
                    action.featured
                      ? "flex size-9 shrink-0 items-center justify-center rounded-lg bg-white/15"
                      : "bg-primary/10 text-primary flex size-9 shrink-0 items-center justify-center rounded-lg"
                  }
                >
                  <action.icon className="size-4.5" />
                </span>
                <span>
                  <span className="block text-sm font-semibold">{action.label}</span>
                  <span
                    className={
                      action.featured
                        ? "mt-0.5 block text-xs text-white/70"
                        : "text-muted-foreground mt-0.5 block text-xs"
                    }
                  >
                    {action.description}
                  </span>
                </span>
              </Link>
            ))}
          </CardContent>
        </Card>

        {/* Kurulum kontrol listesi */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              Kurulum Durumu
              <span className="text-muted-foreground text-sm font-normal">
                {completedSteps}/{checklist.length}
              </span>
            </CardTitle>
            <CardDescription>
              Nöbet çizelgesi yayınlamak için gereken adımlar.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="bg-muted mb-4 h-1.5 overflow-hidden rounded-full">
              <div
                className="bg-primary h-full rounded-full transition-all"
                style={{ width: `${(completedSteps / checklist.length) * 100}%` }}
              />
            </div>
            <ul className="flex flex-col gap-2.5">
              {checklist.map((item) => (
                <li key={item.label}>
                  <Link href={item.href} className="group flex items-center gap-2.5 text-sm">
                    {item.state === "done" ? (
                      <CheckCircle2 className="size-4.5 shrink-0 text-emerald-600" />
                    ) : item.state === "warning" ? (
                      <AlertTriangle className="size-4.5 shrink-0 text-amber-500" />
                    ) : (
                      <Circle className="text-muted-foreground/40 size-4.5 shrink-0" />
                    )}
                    <span
                      className={
                        item.state === "done"
                          ? "text-muted-foreground"
                          : "font-medium group-hover:underline"
                      }
                    >
                      {item.label}
                      {item.hint && (
                        <span className="text-muted-foreground ml-1.5 text-xs font-normal">
                          ({item.hint})
                        </span>
                      )}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>

      {/* Son çizelgeler */}
      <Card>
        <CardHeader>
          <CardTitle>Son Nöbet Çizelgeleri</CardTitle>
          <CardDescription>En son oluşturulan çizelgeler.</CardDescription>
        </CardHeader>
        <CardContent>
          {recentSchedules.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              Nöbet çizelgesi oluşturmak için önce bölge ve eczane bilgilerini tamamlayın.
            </p>
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {recentSchedules.map((schedule) => (
                <Link
                  key={schedule.id}
                  href={`/cizelgeler/${schedule.id}`}
                  className="hover-lift flex flex-col gap-2 rounded-xl border p-4"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="bg-primary/10 text-primary flex size-8 items-center justify-center rounded-lg">
                      <CalendarRange className="size-4" />
                    </span>
                    <Badge variant={schedule.status === "DRAFT" ? "warning" : "success"}>
                      {DUTY_SCHEDULE_STATUS_LABELS[schedule.status] ?? schedule.status}
                    </Badge>
                  </div>
                  <div>
                    <p className="text-sm font-semibold">{schedule.region.name}</p>
                    <p className="text-muted-foreground text-xs">
                      {getTurkishMonthName(schedule.month)} {schedule.year}
                    </p>
                  </div>
                </Link>
              ))}
            </div>
          )}
          <div className="mt-4">
            <Button variant="outline" size="sm" asChild>
              <Link href="/cizelgeler">
                Tüm çizelgeleri görüntüle <ArrowRight className="size-3.5" />
              </Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
