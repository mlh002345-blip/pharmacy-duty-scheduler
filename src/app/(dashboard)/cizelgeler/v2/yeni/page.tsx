import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { prisma } from "@/lib/prisma";
import { requireOrganizationRoleOrRedirect } from "@/lib/auth/tenant";
import { V2GenerationForm } from "./v2-generation-form";

export default async function YeniV2CizelgePage() {
  const user = await requireOrganizationRoleOrRedirect("generateSchedule", "/cizelgeler");
  const regions = await prisma.region.findMany({
    where: { isActive: true, organizationId: user.organizationId },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">V2 Nöbet Taslağı Oluştur</h1>
        <p className="text-muted-foreground text-sm">
          Yeni kural motoru (deneysel) ile bir dönem için taslak oluşturup önizleyin.
        </p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Taslak Bilgileri</CardTitle>
          <CardDescription>
            Seçilen bölge, etkin bir V2 nöbet planı sürümü gerektirir. Taslak oluşturulduktan
            sonra kaydetmeden önce önizleme sayfasında incelenebilir.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <V2GenerationForm regions={regions} />
        </CardContent>
      </Card>
    </div>
  );
}
