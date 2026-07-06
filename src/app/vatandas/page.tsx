import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { prisma } from "@/lib/prisma";
import { addDays, parseDateKey, todayAtUtcMidnight } from "@/lib/scheduling/date-tr";
import {
  getPublishedAssignmentsForDate,
  type PublishedAssignment,
} from "@/lib/scheduling/public-duty-lookup";

export const dynamic = "force-dynamic";

function DutySection({
  title,
  assignments,
}: {
  title: string;
  assignments: PublishedAssignment[];
}) {
  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {assignments.length === 0 && (
          <CardDescription>
            Bu tarih için yayımlanmış nöbetçi eczane bilgisi bulunamadı.
          </CardDescription>
        )}
      </CardHeader>
      {assignments.length > 0 && (
        <CardContent className="flex flex-col gap-4">
          {assignments.map((assignment) => (
            <div key={assignment.id} className="rounded-md border p-4">
              <p className="font-medium">{assignment.pharmacy.name}</p>
              <p className="text-muted-foreground text-sm">{assignment.pharmacy.phone}</p>
              <p className="text-muted-foreground text-sm">{assignment.pharmacy.address}</p>
              {assignment.pharmacy.mapUrl && (
                <a
                  href={assignment.pharmacy.mapUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary mt-1 inline-block text-sm underline"
                >
                  Yol Tarifi Al
                </a>
              )}
            </div>
          ))}
        </CardContent>
      )}
    </Card>
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

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-2xl flex-col gap-6 p-6">
      <div className="text-center">
        <h1 className="text-3xl font-semibold">Nöbetçi Eczaneler</h1>
        <p className="text-muted-foreground mt-2 text-sm">
          Bölgenizdeki nöbetçi eczaneleri buradan görüntüleyebilirsiniz.
        </p>
      </div>

      {regions.length === 0 ? (
        <Card className="w-full">
          <CardHeader>
            <CardDescription>Sistemde tanımlı aktif bölge bulunmuyor.</CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <>
          <Card className="w-full">
            <CardContent className="pt-6">
              <form method="get" className="flex flex-wrap items-end gap-3">
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="regionId" className="text-sm font-medium">
                    Bölge
                  </label>
                  <Select
                    id="regionId"
                    name="regionId"
                    defaultValue={selectedRegionId ?? ""}
                    className="w-56"
                  >
                    {regions.map((region) => (
                      <option key={region.id} value={region.id}>
                        {region.name}
                      </option>
                    ))}
                  </Select>
                </div>
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="date" className="text-sm font-medium">
                    Tarih Seç (opsiyonel)
                  </label>
                  <Input id="date" name="date" type="date" defaultValue={dateParam ?? ""} className="w-44" />
                </div>
                <Button type="submit" variant="secondary">
                  Görüntüle
                </Button>
              </form>
            </CardContent>
          </Card>

          <DutySection title="Bugünün Nöbetçi Eczaneleri" assignments={todayAssignments} />
          <DutySection title="Yarınki Nöbetçi Eczaneleri" assignments={tomorrowAssignments} />
          {customDate && (
            <DutySection
              title={`${customDate.toLocaleDateString("tr-TR")} Nöbetçi Eczaneleri`}
              assignments={customAssignments}
            />
          )}
        </>
      )}
    </div>
  );
}
