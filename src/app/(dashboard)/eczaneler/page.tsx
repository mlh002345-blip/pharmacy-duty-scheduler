import { Badge } from "@/components/ui/badge";
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

export default async function EczanelerPage() {
  const pharmacies = await prisma.pharmacy.findMany({
    include: { region: true },
    orderBy: { name: "asc" },
  });

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Eczaneler</h1>
        <p className="text-muted-foreground text-sm">
          Sisteme kayıtlı tüm eczaneler ({pharmacies.length} kayıt).
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Eczane Listesi</CardTitle>
          <CardDescription>Bölge ve durum bilgisiyle birlikte.</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Eczane Adı</TableHead>
                <TableHead>Bölge</TableHead>
                <TableHead>Adres</TableHead>
                <TableHead>Telefon</TableHead>
                <TableHead>Durum</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pharmacies.map((pharmacy) => (
                <TableRow key={pharmacy.id}>
                  <TableCell className="font-medium">{pharmacy.name}</TableCell>
                  <TableCell>{pharmacy.region.name}</TableCell>
                  <TableCell className="max-w-xs truncate">{pharmacy.address}</TableCell>
                  <TableCell>{pharmacy.phone}</TableCell>
                  <TableCell>
                    <Badge variant={pharmacy.isActive ? "default" : "secondary"}>
                      {pharmacy.isActive ? "Aktif" : "Pasif"}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
