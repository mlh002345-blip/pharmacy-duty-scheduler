import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export default async function BolgelerPage() {
  const regions = await prisma.region.findMany({
    include: { _count: { select: { pharmacies: true, dutyRules: true } } },
    orderBy: { name: "asc" },
  });

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Nöbet Bölgeleri</h1>
        <p className="text-muted-foreground text-sm">
          Eczanelerin gruplandığı nöbet bölgeleri.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Bölge Listesi</CardTitle>
          <CardDescription>Bölge başına eczane ve kural sayısı.</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Bölge Adı</TableHead>
                <TableHead>Eczane Sayısı</TableHead>
                <TableHead>Nöbet Kuralı Sayısı</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {regions.map((region) => (
                <TableRow key={region.id}>
                  <TableCell className="font-medium">{region.name}</TableCell>
                  <TableCell>{region._count.pharmacies}</TableCell>
                  <TableCell>{region._count.dutyRules}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
