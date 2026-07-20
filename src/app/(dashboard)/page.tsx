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
import { requireOrganizationMember } from "@/lib/auth/tenant";
import { hasPermission } from "@/lib/auth/permissions";
import { getTurkishMonthName, todayAtUtcMidnight } from "@/lib/scheduling/date-tr";
import { DUTY_SCHEDULE_STATUS_LABELS } from "@/lib/scheduling/duty-schedule-labels";
import { getDataHealthReport } from "@/lib/health/data-health";
import { DUTY_REQUEST_TYPE_LABELS } from "@/lib/duty-requests/labels";
import { SendRemindersButton } from "./send-reminders-button";

export const dynamic = "force-dynamic";

export default async function PanelPage() {
  const user = await requireOrganizationMember();
  const canGenerate = hasPermission(user.role, "generateSchedule");
  const canManage = hasPermission(user.role, "manageSetupData");
  const canViewAuditLog = hasPermission(user.role, "manageUsers");
  const canSendReminders = hasPermission(user.role, "sendReminders");
  const organization = await prisma.organization.findUnique({
    where: { id: user.organizationId },
    select: { slug: true },
  });
  const vatandasHref = organization?.slug
    ? `/vatandas?org=${encodeURIComponent(organization.slug)}`
    : "/vatandas";

  const today = todayAtUtcMidnight();

  const [
    pharmacyCount,
    activePharmacyCount,
    activeRegionCount,
    dutyRuleCount,
    holidayCount,
    draftScheduleCount,
    publishedScheduleCount,
    todayDuty,
    lastManualChange,
    recentSchedules,
    pendingDutyRequestCount,
    historicalRecordCount,
  ] = await Promise.all([
    prisma.pharmacy.count({ where: { region: { organizationId: user.organizationId } } }),
    prisma.pharmacy.count({
      where: { isActive: true, region: { organizationId: user.organizationId } },
    }),
    prisma.region.count({ where: { isActive: true, organizationId: user.organizationId } }),
    prisma.dutyRule.count({ where: { region: { organizationId: user.organizationId } } }),
    prisma.holiday.count(),
    prisma.dutySchedule.count({
      where: { status: "DRAFT", region: { organizationId: user.organizationId } },
    }),
    prisma.dutySchedule.count({
      where: { status: "PUBLISHED", region: { organizationId: user.organizationId } },
    }),
    prisma.dutyAssignment.findFirst({
      where: {
        date: today,
        dutySchedule: { status: "PUBLISHED", region: { organizationId: user.organizationId } },
      },
      select: {
        pharmacy: { select: { name: true } },
        dutySchedule: { select: { region: { select: { name: true } } } },
      },
      orderBy: { dutySchedule: { region: { name: "asc" } } },
    }),
    prisma.auditLog.findFirst({
      where: { entity: "DutyAssignment", organizationId: user.organizationId },
      select: { createdAt: true, user: { select: { name: true } } },
      orderBy: { createdAt: "desc" },
    }),
    prisma.dutySchedule.findMany({
      where: { region: { organizationId: user.organizationId } },
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
    prisma.dutyRequest.count({
      where: { status: "PENDING", pharmacy: { region: { organizationId: user.organizationId } } },
    }),
    prisma.historicalDutyRecord.count({ where: { batch: { organizationId: user.organizationId } } }),
  ]);

  // Bekleyen talepler yalnızca aşağıdaki kurulum listesinde tek satır
  // olarak görünmüyor — eczacının doğrudan gönderdiği bir mazeret/tercih
  // fark edilmeden kaybolmasın diye panelin en üstünde ayrıca uyarı olarak
  // gösterilir (bkz. kullanıcı talebi: "sisteme girince uyarı olarak
  // görünsün mazeret var diye").
  const pendingDutyRequests =
    pendingDutyRequestCount > 0
      ? await prisma.dutyRequest.findMany({
          where: { status: "PENDING", pharmacy: { region: { organizationId: user.organizationId } } },
          select: { requestType: true, createdAt: true, pharmacy: { select: { name: true } } },
          orderBy: { createdAt: "asc" },
          take: 3,
        })
      : [];
  const emergencyPendingCount =
    pendingDutyRequestCount > 0
      ? await prisma.dutyRequest.count({
          where: {
            status: "PENDING",
            requestType: "EMERGENCY_EXCUSE",
            pharmacy: { region: { organizationId: user.organizationId } },
          },
        })
      : 0;

  // Veri kontrolü yapıldı mı? — /veri-kontrol ile aynı sağlık raporunu
  // yeniden kullanır; oda ölçeğindeki veri hacminde ("düzine" seviyesinde
  // kayıt) bu sorgu setinin panelde de çalıştırılması hafif kalır.
  const dataHealthReport = await getDataHealthReport(user.organizationId);

  const todayLabel = new Date().toLocaleDateString("tr-TR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  type ChecklistState = "done" | "missing" | "warning";
  const checklist: { label: string; state: ChecklistState; href: string }[] = [
    {
      label: "Bölge tanımlandı mı?",
      state: activeRegionCount > 0 ? "done" : "missing",
      href: "/bolgeler",
    },
    {
      label: "Eczaneler eklendi mi?",
      state: pharmacyCount > 0 ? "done" : "missing",
      href: "/eczaneler",
    },
    {
      label: "Nöbet kuralları tanımlandı mı?",
      state:
        dutyRuleCount === 0
          ? "missing"
          : dutyRuleCount < activeRegionCount
            ? "warning"
            : "done",
      href: "/kurallar",
    },
    {
      label: "Tatil günleri yüklendi mi?",
      state: holidayCount > 0 ? "done" : "warning",
      href: "/tatil-gunleri",
    },
    {
      label: "Geçmiş nöbetler aktarıldı mı?",
      state: historicalRecordCount > 0 ? "done" : "warning",
      href: "/gecmis-nobetler",
    },
    {
      label: "Bekleyen nöbet talepleri incelendi mi?",
      state: pendingDutyRequestCount === 0 ? "done" : "warning",
      href: "/nobet-talepleri",
    },
    {
      label: "Veri kontrolü yapıldı mı?",
      state:
        dataHealthReport.critical.length > 0
          ? "missing"
          : dataHealthReport.warnings.length > 0
            ? "warning"
            : "done",
      href: "/veri-kontrol",
    },
    {
      label: "Yayında çizelge var mı?",
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
      href: vatandasHref,
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

      {/* Bekleyen nöbet talepleri uyarısı */}
      {pendingDutyRequestCount > 0 && (
        <Link
          href="/nobet-talepleri"
          className={`hover-lift flex items-start gap-3 rounded-xl border p-4 text-sm ${
            emergencyPendingCount > 0
              ? "border-destructive/40 bg-destructive/5"
              : "border-amber-300/60 bg-amber-50"
          }`}
        >
          <AlertTriangle
            className={`mt-0.5 size-5 shrink-0 ${
              emergencyPendingCount > 0 ? "text-destructive" : "text-amber-600"
            }`}
          />
          <div className="flex-1">
            <p className={`font-semibold ${emergencyPendingCount > 0 ? "text-destructive" : "text-amber-900"}`}>
              {pendingDutyRequestCount === 1
                ? "İncelenmemiş 1 nöbet talebi var"
                : `İncelenmemiş ${pendingDutyRequestCount} nöbet talebi var`}
              {emergencyPendingCount > 0 &&
                ` (${emergencyPendingCount} tanesi acil mazeret)`}
            </p>
            <p className={`mt-0.5 ${emergencyPendingCount > 0 ? "text-destructive/80" : "text-amber-800"}`}>
              {pendingDutyRequests
                .map(
                  (request) =>
                    `${request.pharmacy.name} — ${DUTY_REQUEST_TYPE_LABELS[request.requestType]}`
                )
                .join(", ")}
              {pendingDutyRequestCount > pendingDutyRequests.length && " ve diğerleri"}
            </p>
          </div>
          <ArrowRight
            className={`mt-0.5 size-4 shrink-0 ${emergencyPendingCount > 0 ? "text-destructive" : "text-amber-600"}`}
          />
        </Link>
      )}

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
            href={vatandasHref}
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
          {canViewAuditLog && (
            <Link
              href="/denetim-kayitlari"
              className="text-primary mt-3 inline-flex items-center gap-1.5 text-sm font-medium underline-offset-4 hover:underline"
            >
              Denetim kayıtlarını aç <ArrowRight className="size-3.5" />
            </Link>
          )}
        </div>
      </div>

      {canSendReminders && (
        <Card>
          <CardHeader>
            <CardTitle>Nöbet Hatırlatmaları</CardTitle>
            <CardDescription>
              Yarın nöbetçi olan, e-postası tanımlı eczanelere hatırlatma gönderin. Daha
              önce gönderilmiş bir atamaya ikinci kez gönderilmez.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <SendRemindersButton />
          </CardContent>
        </Card>
      )}

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
                  <Link
                    href={item.href}
                    className="group flex items-center justify-between gap-2.5 text-sm"
                  >
                    <span className="flex items-center gap-2.5">
                      {item.state === "done" ? (
                        <CheckCircle2 className="size-4.5 shrink-0 text-emerald-600" />
                      ) : item.state === "warning" ? (
                        <AlertTriangle className="size-4.5 shrink-0 text-amber-600" />
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
                      </span>
                    </span>
                    <Badge
                      variant={
                        item.state === "done"
                          ? "success"
                          : item.state === "warning"
                            ? "warning"
                            : "secondary"
                      }
                    >
                      {item.state === "done"
                        ? "Tamamlandı"
                        : item.state === "warning"
                          ? "Uyarı"
                          : "Eksik"}
                    </Badge>
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
