import {
  CalendarSearch,
  Cross,
  MapPin,
  Navigation,
  Phone,
  SearchX,
  Siren,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/layout/empty-state";
import { DutyMap } from "@/components/visuals/duty-map";
import { prisma } from "@/lib/prisma";
import { addDays, parseDateKey, todayAtUtcMidnight } from "@/lib/scheduling/date-tr";
import {
  getPublishedAssignmentsForDate,
  type PublishedAssignment,
} from "@/lib/scheduling/public-duty-lookup";

export const dynamic = "force-dynamic";

// Kayıtta mapUrl yoksa; ad + adres + ilçe/şehirden API anahtarı gerektirmeyen
// bir Google Maps arama bağlantısı üretilir. Böylece "Yol Tarifi Al" her
// kartta görünür.
function routeUrl(pharmacy: PublishedAssignment["pharmacy"]): string {
  if (pharmacy.mapUrl) return pharmacy.mapUrl;
  const query = [pharmacy.name, pharmacy.address, pharmacy.district, pharmacy.city]
    .filter(Boolean)
    .join(" ");
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

function PharmacyCard({
  assignment,
  regionName,
  number,
  dayBadge,
  featured = false,
}: {
  assignment: PublishedAssignment;
  regionName?: string;
  number?: number;
  dayBadge?: "today" | "tomorrow";
  featured?: boolean;
}) {
  const { pharmacy } = assignment;
  const telHref = `tel:${pharmacy.phone.replace(/\s/g, "")}`;

  return (
    <div
      className={
        featured
          ? "hover-lift flex flex-col gap-3 rounded-2xl border border-emerald-600/25 bg-white p-5 shadow-md ring-1 ring-emerald-600/10"
          : "hover-lift flex flex-col gap-3 rounded-2xl border bg-white p-4 shadow-sm"
      }
    >
      <div className="flex items-start gap-3">
        {number !== undefined ? (
          <span
            className={
              featured
                ? "flex size-10 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-base font-bold text-white shadow-sm"
                : "flex size-9 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-sm font-bold text-white shadow-sm"
            }
          >
            {number}
          </span>
        ) : (
          <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-emerald-50 text-emerald-700">
            <Cross className="size-4" strokeWidth={2.5} />
          </span>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <p className={featured ? "text-lg font-semibold tracking-tight" : "font-semibold tracking-tight"}>
              {pharmacy.name}
            </p>
            {dayBadge === "today" && <Badge variant="success">Bugün Nöbetçi</Badge>}
            {dayBadge === "tomorrow" && <Badge variant="info">Yarın Nöbetçi</Badge>}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
            {regionName && (
              <Badge variant="secondary">
                <MapPin className="size-3" />
                {regionName}
              </Badge>
            )}
            <span className="text-muted-foreground inline-flex items-center gap-1 text-sm">
              <Phone className="size-3.5" />
              {pharmacy.phone}
            </span>
          </div>
          <p className="text-muted-foreground mt-1.5 text-sm">{pharmacy.address}</p>
        </div>
      </div>
      <div className="mt-auto flex flex-wrap gap-2">
        <Button size="sm" asChild>
          <a href={telHref}>
            <Phone className="size-3.5" />
            Telefonla Ara
          </a>
        </Button>
        <Button size="sm" variant="outline" asChild>
          <a href={routeUrl(pharmacy)} target="_blank" rel="noopener noreferrer">
            <Navigation className="size-3.5" />
            Yol Tarifi Al
          </a>
        </Button>
      </div>
    </div>
  );
}

function SectionHeading({
  title,
  count,
  primary = false,
}: {
  title: string;
  count: number;
  primary?: boolean;
}) {
  return (
    <div className="flex items-center gap-2.5">
      <span
        className={
          primary
            ? "h-6 w-1.5 rounded-full bg-emerald-600"
            : "bg-muted-foreground/30 h-5 w-1 rounded-full"
        }
      />
      <h2
        className={
          primary
            ? "text-xl font-semibold tracking-tight"
            : "text-lg font-semibold tracking-tight"
        }
      >
        {title}
      </h2>
      {count > 0 && (
        <span className="text-muted-foreground rounded-full border bg-white px-2 py-0.5 text-xs font-medium whitespace-nowrap">
          {count} eczane
        </span>
      )}
    </div>
  );
}

function SectionEmpty() {
  return (
    <EmptyState
      icon={SearchX}
      title="Bu tarih için yayımlanmış nöbetçi eczane bilgisi bulunamadı."
      description="Lütfen başka bir bölge veya tarih seçin ya da daha sonra tekrar deneyin."
    />
  );
}

export default async function VatandasEkraniPage({
  searchParams,
}: {
  searchParams: Promise<{ regionId?: string; date?: string; org?: string }>;
}) {
  const { regionId: regionIdParam, date: dateParam, org: orgSlugParam } = await searchParams;

  // Bu sayfa kimlik doğrulama gerektirmez; organizasyon bağlamı yalnızca
  // ?org=<slug> parametresinden (veya tek aktif organizasyon varsa ondan)
  // türetilir — asla bölge/eczane kayıtları önce organizasyon sınırı
  // olmadan global olarak çekilip sonradan filtrelenmez.
  const organization = orgSlugParam
    ? await prisma.organization.findFirst({
        where: { slug: orgSlugParam, isActive: true },
        select: { id: true, name: true, slug: true },
      })
    : await (async () => {
        const activeOrganizations = await prisma.organization.findMany({
          where: { isActive: true },
          select: { id: true, name: true, slug: true },
          orderBy: { name: "asc" },
          take: 2,
        });
        return activeOrganizations.length === 1 ? activeOrganizations[0] : null;
      })();

  if (!organization) {
    const organizations = orgSlugParam
      ? []
      : await prisma.organization.findMany({
          where: { isActive: true },
          select: { name: true, slug: true },
          orderBy: { name: "asc" },
        });
    return (
      <div className="bg-background flex min-h-screen flex-col items-center justify-center gap-4 px-4 py-10 text-center">
        <MapPin className="text-muted-foreground size-8" />
        <h1 className="text-xl font-semibold tracking-tight">Eczacı Odası Seçin</h1>
        {organizations.length === 0 ? (
          <p className="text-muted-foreground max-w-sm text-sm">
            Bu bağlantı geçersiz veya artık kullanılamıyor.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {organizations.map((org) => (
              <li key={org.slug}>
                <a
                  className="text-primary underline underline-offset-2"
                  href={`/vatandas?org=${encodeURIComponent(org.slug)}`}
                >
                  {org.name}
                </a>
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }

  const regions = await prisma.region.findMany({
    where: { isActive: true, organizationId: organization.id },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });

  const selectedRegionId =
    regionIdParam && regions.some((r) => r.id === regionIdParam)
      ? regionIdParam
      : regions[0]?.id;
  const selectedRegion = regions.find((r) => r.id === selectedRegionId);

  const today = todayAtUtcMidnight();
  const tomorrow = addDays(today, 1);
  const customDate = dateParam ? parseDateKey(dateParam) : null;

  let todayAssignments: PublishedAssignment[] = [];
  let tomorrowAssignments: PublishedAssignment[] = [];
  let customAssignments: PublishedAssignment[] = [];

  if (selectedRegionId) {
    [todayAssignments, tomorrowAssignments] = await Promise.all([
      getPublishedAssignmentsForDate(selectedRegionId, today),
      getPublishedAssignmentsForDate(selectedRegionId, tomorrow),
    ]);
    if (customDate) {
      customAssignments = await getPublishedAssignmentsForDate(selectedRegionId, customDate);
    }
  }

  const todayLabel = new Date().toLocaleDateString("tr-TR", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });

  return (
    <div className="bg-background min-h-screen">
      {/* Hero */}
      <header className="from-navy relative overflow-hidden bg-gradient-to-br to-[oklch(0.36_0.06_220)] pb-20 text-white">
        <div
          aria-hidden
          className="absolute inset-0"
          style={{
            background:
              "radial-gradient(70% 90% at 80% 10%, oklch(0.55 0.11 163 / 0.45) 0%, transparent 55%)",
          }}
        />
        <div className="relative z-10 mx-auto flex w-full max-w-3xl flex-col items-center px-6 pt-10 text-center sm:pt-14">
          <div className="flex size-13 items-center justify-center rounded-2xl bg-white/10 shadow-lg backdrop-blur">
            <Cross className="size-6 text-emerald-300" strokeWidth={2.5} />
          </div>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">
            Nöbetçi Eczaneler
          </h1>
          <p className="mt-2 max-w-md text-sm text-white/70 sm:text-base">
            Bölgenizi seçin, bugünün ve yarının nöbetçi eczanelerine telefon ve adres
            bilgileriyle ulaşın.
          </p>
          <p className="mt-3 rounded-full bg-white/10 px-4 py-1.5 text-sm backdrop-blur first-letter:uppercase">
            {todayLabel}
          </p>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 pb-12 sm:px-6">
        {regions.length === 0 ? (
          <div className="relative z-10 -mt-12">
            <EmptyState
              icon={MapPin}
              title="Sistemde tanımlı aktif bölge bulunmuyor."
              description="Nöbetçi eczane bilgisi için lütfen daha sonra tekrar deneyin."
            />
          </div>
        ) : (
          <>
            {/* Bölge / tarih seçimi (hero üzerine bindirilmiş kart) */}
            <div className="relative z-10 mx-auto -mt-12 w-full max-w-3xl rounded-2xl border bg-white p-4 shadow-lg sm:p-5">
              <form method="get" className="flex flex-col gap-3 sm:flex-row sm:items-end">
                <input type="hidden" name="org" value={organization.slug} />
                <div className="flex flex-1 flex-col gap-1.5">
                  <label htmlFor="regionId" className="text-sm font-medium">
                    Bölge
                  </label>
                  <Select id="regionId" name="regionId" defaultValue={selectedRegionId ?? ""}>
                    {regions.map((region) => (
                      <option key={region.id} value={region.id}>
                        {region.name}
                      </option>
                    ))}
                  </Select>
                </div>
                <div className="flex flex-1 flex-col gap-1.5">
                  <label htmlFor="date" className="text-sm font-medium">
                    Tarih Seç <span className="text-muted-foreground font-normal">(opsiyonel)</span>
                  </label>
                  <Input id="date" name="date" type="date" defaultValue={dateParam ?? ""} />
                </div>
                <Button type="submit" className="sm:w-auto">
                  <CalendarSearch className="size-4" />
                  Görüntüle
                </Button>
              </form>
              {selectedRegion && (
                <p className="text-muted-foreground mt-3 text-center text-sm">
                  <span className="text-foreground font-medium">{selectedRegion.name}</span>{" "}
                  bölgesi için nöbetçi eczaneler gösteriliyor.
                </p>
              )}
            </div>

            {/* İçerik: solda kartlar, sağda yapışkan harita (masaüstü) */}
            <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_420px]">
              {/* Harita — mobilde üstte, masaüstünde sağ sütunda yapışkan */}
              {todayAssignments.length > 0 && (
                <div className="lg:sticky lg:top-6 lg:order-2">
                  <DutyMap
                    pharmacies={todayAssignments.map((a) => ({
                      id: a.id,
                      name: a.pharmacy.name,
                      mapUrl: routeUrl(a.pharmacy),
                    }))}
                  />
                </div>
              )}

              <div className="flex min-w-0 flex-col gap-6 lg:order-1">
                {/* Bugün */}
                <section className="flex flex-col gap-3">
                  <SectionHeading
                    title="Bugünün Nöbetçi Eczaneleri"
                    count={todayAssignments.length}
                    primary
                  />
                  {todayAssignments.length === 0 ? (
                    <SectionEmpty />
                  ) : (
                    <div className="flex flex-col gap-3">
                      {todayAssignments.map((assignment, index) => (
                        <PharmacyCard
                          key={assignment.id}
                          assignment={assignment}
                          regionName={selectedRegion?.name}
                          number={index + 1}
                          dayBadge="today"
                          featured
                        />
                      ))}
                    </div>
                  )}
                </section>

                {/* Yarın */}
                <section className="flex flex-col gap-3">
                  <SectionHeading
                    title="Yarınki Nöbetçi Eczaneleri"
                    count={tomorrowAssignments.length}
                  />
                  {tomorrowAssignments.length === 0 ? (
                    <SectionEmpty />
                  ) : (
                    <div className="flex flex-col gap-3">
                      {tomorrowAssignments.map((assignment) => (
                        <PharmacyCard
                          key={assignment.id}
                          assignment={assignment}
                          regionName={selectedRegion?.name}
                          dayBadge="tomorrow"
                        />
                      ))}
                    </div>
                  )}
                </section>

                {/* Seçilen tarih */}
                {customDate && (
                  <section className="flex flex-col gap-3">
                    <SectionHeading
                      title={`${customDate.toLocaleDateString("tr-TR", {
                        day: "numeric",
                        month: "long",
                        year: "numeric",
                      })} Nöbetçi Eczaneleri`}
                      count={customAssignments.length}
                    />
                    {customAssignments.length === 0 ? (
                      <SectionEmpty />
                    ) : (
                      <div className="flex flex-col gap-3">
                        {customAssignments.map((assignment) => (
                          <PharmacyCard
                            key={assignment.id}
                            assignment={assignment}
                            regionName={selectedRegion?.name}
                          />
                        ))}
                      </div>
                    )}
                  </section>
                )}
              </div>
            </div>
          </>
        )}

        {/* Güven / acil durum notu */}
        <footer className="mx-auto w-full max-w-3xl">
          <div className="flex items-center justify-center gap-3 rounded-2xl border bg-white px-5 py-4 shadow-sm">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-red-50 text-red-600">
              <Siren className="size-4.5" />
            </span>
            <p className="text-muted-foreground text-sm">
              Nöbet bilgileri ilgili eczacı odası tarafından yayımlanan çizelgelere dayanır.{" "}
              <span className="text-foreground font-medium">
                Acil durumlarda 112&apos;yi arayınız.
              </span>
            </p>
          </div>
        </footer>
      </main>
    </div>
  );
}
