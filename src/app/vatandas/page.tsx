import { CalendarSearch, Cross, MapPin, Navigation, Phone, SearchX } from "lucide-react";

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

function PharmacyCard({
  assignment,
  number,
}: {
  assignment: PublishedAssignment;
  number?: number;
}) {
  const { pharmacy } = assignment;
  const telHref = `tel:${pharmacy.phone.replace(/\s/g, "")}`;

  return (
    <div className="hover-lift flex flex-col gap-3 rounded-2xl border bg-white p-5 shadow-sm">
      <div className="flex items-start gap-3">
        {number !== undefined ? (
          <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-sm font-bold text-white shadow-sm">
            {number}
          </span>
        ) : (
          <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-emerald-50 text-emerald-700">
            <Cross className="size-4" strokeWidth={2.5} />
          </span>
        )}
        <div className="min-w-0">
          <p className="font-semibold tracking-tight">{pharmacy.name}</p>
          <p className="text-muted-foreground mt-0.5 flex items-start gap-1.5 text-sm">
            <MapPin className="mt-0.5 size-3.5 shrink-0" />
            {pharmacy.address}
          </p>
        </div>
      </div>
      <div className="mt-auto flex flex-wrap gap-2">
        <Button size="sm" asChild>
          <a href={telHref}>
            <Phone className="size-3.5" />
            {pharmacy.phone}
          </a>
        </Button>
        {pharmacy.mapUrl && (
          <Button size="sm" variant="outline" asChild>
            <a href={pharmacy.mapUrl} target="_blank" rel="noopener noreferrer">
              <Navigation className="size-3.5" />
              Yol Tarifi Al
            </a>
          </Button>
        )}
      </div>
    </div>
  );
}

function DutySection({
  title,
  assignments,
  numbered = false,
}: {
  title: string;
  assignments: PublishedAssignment[];
  numbered?: boolean;
}) {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
        {assignments.length > 0 && (
          <span className="text-muted-foreground rounded-full border bg-white px-2 py-0.5 text-xs font-medium">
            {assignments.length} eczane
          </span>
        )}
      </div>
      {assignments.length === 0 ? (
        <EmptyState
          icon={SearchX}
          title="Bu tarih için yayımlanmış nöbetçi eczane bilgisi bulunamadı."
          description="Lütfen başka bir bölge veya tarih seçin ya da daha sonra tekrar deneyin."
        />
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {assignments.map((assignment, index) => (
            <PharmacyCard
              key={assignment.id}
              assignment={assignment}
              number={numbered ? index + 1 : undefined}
            />
          ))}
        </div>
      )}
    </section>
  );
}

export default async function VatandasEkraniPage({
  searchParams,
}: {
  searchParams: Promise<{ regionId?: string; date?: string }>;
}) {
  const { regionId: regionIdParam, date: dateParam } = await searchParams;

  const regions = await prisma.region.findMany({
    where: { isActive: true },
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
      <header className="from-navy relative overflow-hidden bg-gradient-to-br to-[oklch(0.36_0.06_220)] pb-24 text-white">
        <div
          aria-hidden
          className="absolute inset-0"
          style={{
            background:
              "radial-gradient(70% 90% at 80% 10%, oklch(0.55 0.11 163 / 0.45) 0%, transparent 55%)",
          }}
        />
        <div className="relative z-10 mx-auto flex w-full max-w-3xl flex-col items-center px-6 pt-12 text-center sm:pt-16">
          <div className="flex size-14 items-center justify-center rounded-2xl bg-white/10 shadow-lg backdrop-blur">
            <Cross className="size-7 text-emerald-300" strokeWidth={2.5} />
          </div>
          <h1 className="mt-4 text-3xl font-semibold tracking-tight sm:text-4xl">
            Nöbetçi Eczaneler
          </h1>
          <p className="mt-2 max-w-md text-sm text-white/70 sm:text-base">
            Bölgenizi seçin, bugünün ve yarının nöbetçi eczanelerine telefon ve adres
            bilgileriyle ulaşın.
          </p>
          <p className="mt-4 rounded-full bg-white/10 px-4 py-1.5 text-sm backdrop-blur first-letter:uppercase">
            {todayLabel}
          </p>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-4 pb-16 sm:px-6">
        {regions.length === 0 ? (
          <div className="relative z-10 -mt-14">
            <EmptyState
              icon={MapPin}
              title="Sistemde tanımlı aktif bölge bulunmuyor."
              description="Nöbetçi eczane bilgisi için lütfen daha sonra tekrar deneyin."
            />
          </div>
        ) : (
          <>
            {/* Bölge / tarih seçimi (hero üzerine bindirilmiş kart) */}
            <div className="relative z-10 -mt-14 rounded-2xl border bg-white p-4 shadow-lg sm:p-5">
              <form method="get" className="flex flex-col gap-3 sm:flex-row sm:items-end">
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
            </div>

            {selectedRegion && (
              <p className="text-muted-foreground -mt-3 text-center text-sm">
                <span className="text-foreground font-medium">{selectedRegion.name}</span> bölgesi
                için nöbetçi eczaneler gösteriliyor.
              </p>
            )}

            {/* Nöbet haritası (bugün) */}
            {todayAssignments.length > 0 && (
              <DutyMap
                pharmacies={todayAssignments.map((a) => ({
                  id: a.id,
                  name: a.pharmacy.name,
                  mapUrl: a.pharmacy.mapUrl,
                }))}
              />
            )}

            <DutySection
              title="Bugünün Nöbetçi Eczaneleri"
              assignments={todayAssignments}
              numbered
            />
            <DutySection title="Yarınki Nöbetçi Eczaneleri" assignments={tomorrowAssignments} />
            {customDate && (
              <DutySection
                title={`${customDate.toLocaleDateString("tr-TR", {
                  day: "numeric",
                  month: "long",
                  year: "numeric",
                })} Nöbetçi Eczaneleri`}
                assignments={customAssignments}
              />
            )}
          </>
        )}

        <footer className="text-muted-foreground border-t pt-6 text-center text-xs">
          Nöbet bilgileri eczacı odası tarafından yayımlanan çizelgelere dayanır. Acil durumlar
          için 112&apos;yi arayınız.
        </footer>
      </main>
    </div>
  );
}
