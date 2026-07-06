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

const ENTITY_LABELS: Record<string, string> = {
  Region: "Bölge",
  Pharmacy: "Eczane",
  DutyRule: "Nöbet Kuralı",
  Holiday: "Tatil Günü",
  Unavailability: "Mazeret",
  DutySchedule: "Nöbet Çizelgesi",
  DutyAssignment: "Nöbet Ataması",
};

const ACTION_LABELS: Record<string, string> = {
  CREATE: "Oluşturuldu",
  UPDATE: "Güncellendi",
  DELETE: "Silindi",
};

type DutyAssignmentChange = {
  pharmacyId?: string;
  pharmacyName?: string;
  note?: string | null;
  reason?: string;
};

function parseJson(value: string | null): unknown {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function describeDutyAssignmentChange(
  before: string | null,
  after: string | null
): string | null {
  const beforeValue = parseJson(before) as DutyAssignmentChange | null;
  const afterValue = parseJson(after) as DutyAssignmentChange | null;
  if (!beforeValue || !afterValue) return null;

  const oldName = beforeValue.pharmacyName ?? "-";
  const newName = afterValue.pharmacyName ?? "-";
  const reason = afterValue.reason ?? afterValue.note;

  return `${oldName} → ${newName}${reason ? ` (Neden: ${reason})` : ""}`;
}

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
                  <TableHead>Detay</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {auditLogs.map((log) => {
                  const detail =
                    log.entity === "DutyAssignment"
                      ? describeDutyAssignmentChange(log.before, log.after)
                      : null;

                  return (
                    <TableRow key={log.id}>
                      <TableCell>{log.createdAt.toLocaleString("tr-TR")}</TableCell>
                      <TableCell>{log.user.name}</TableCell>
                      <TableCell>{ACTION_LABELS[log.action] ?? log.action}</TableCell>
                      <TableCell>{ENTITY_LABELS[log.entity] ?? log.entity}</TableCell>
                      <TableCell>{detail ?? "-"}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
