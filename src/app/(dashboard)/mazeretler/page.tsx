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

export default async function MazeretlerPage() {
  const unavailabilities = await prisma.unavailability.findMany({
    include: { pharmacy: true },
    orderBy: { startDate: "asc" },
  });

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Mazeretler</h1>
        <p className="text-muted-foreground text-sm">
          Eczanelerin nöbet tutamayacağı tarih aralıkları.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Mazeret Listesi</CardTitle>
          <CardDescription>{unavailabilities.length} kayıt.</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Eczane</TableHead>
                <TableHead>Başlangıç</TableHead>
                <TableHead>Bitiş</TableHead>
                <TableHead>Açıklama</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {unavailabilities.map((item) => (
                <TableRow key={item.id}>
                  <TableCell className="font-medium">{item.pharmacy.name}</TableCell>
                  <TableCell>{item.startDate.toLocaleDateString("tr-TR")}</TableCell>
                  <TableCell>{item.endDate.toLocaleDateString("tr-TR")}</TableCell>
                  <TableCell>{item.reason ?? "-"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
