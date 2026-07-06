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

export default async function DenetimKayitlariPage() {
  const auditLogs = await prisma.auditLog.findMany({
    include: { user: true },
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Denetim Kayıtları</h1>
        <p className="text-muted-foreground text-sm">
          Manuel nöbet çizelgesi değişikliklerinin denetim izi.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Kayıt Listesi</CardTitle>
          <CardDescription>Son 50 işlem gösteriliyor.</CardDescription>
        </CardHeader>
        <CardContent>
          {auditLogs.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              Henüz bir denetim kaydı bulunmuyor.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Tarih</TableHead>
                  <TableHead>Kullanıcı</TableHead>
                  <TableHead>İşlem</TableHead>
                  <TableHead>Varlık</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {auditLogs.map((log) => (
                  <TableRow key={log.id}>
                    <TableCell>{log.createdAt.toLocaleString("tr-TR")}</TableCell>
                    <TableCell>{log.user.name}</TableCell>
                    <TableCell>{log.action}</TableCell>
                    <TableCell>
                      {log.entity} #{log.entityId}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
