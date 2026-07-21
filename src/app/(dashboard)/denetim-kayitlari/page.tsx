import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { History } from "lucide-react";

import { EmptyState } from "@/components/layout/empty-state";
import { Pagination, DEFAULT_PAGE_SIZE, parsePageParam } from "@/components/layout/pagination";
import { prisma } from "@/lib/prisma";
import { DUTY_SCHEDULE_STATUS_LABELS } from "@/lib/scheduling/duty-schedule-labels";
import { ROLE_LABELS } from "@/lib/auth/permissions";
import { requireOrganizationRoleOrRedirect } from "@/lib/auth/tenant";

export const dynamic = "force-dynamic";

const ENTITY_LABELS: Record<string, string> = {
  Region: "Bölge",
  Pharmacy: "Eczane",
  DutyRule: "Nöbet Kuralı",
  Holiday: "Tatil Günü",
  Unavailability: "Mazeret",
  DutySchedule: "Nöbet Çizelgesi",
  DutyAssignment: "Nöbet Ataması",
  User: "Kullanıcı",
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

type DutyScheduleChange = { status?: string };

function describeDutyScheduleChange(
  before: string | null,
  after: string | null
): string | null {
  const beforeValue = parseJson(before) as DutyScheduleChange | null;
  const afterValue = parseJson(after) as DutyScheduleChange | null;
  if (!afterValue?.status) return null;

  const oldStatus = beforeValue?.status
    ? (DUTY_SCHEDULE_STATUS_LABELS[beforeValue.status] ?? beforeValue.status)
    : null;
  const newStatus = DUTY_SCHEDULE_STATUS_LABELS[afterValue.status] ?? afterValue.status;

  return oldStatus ? `${oldStatus} → ${newStatus}` : newStatus;
}

type UserChange = {
  name?: string;
  email?: string;
  role?: string;
  isActive?: boolean;
  passwordChanged?: boolean;
};

function describeUserChange(before: string | null, after: string | null): string | null {
  const beforeValue = parseJson(before) as UserChange | null;
  const afterValue = parseJson(after) as UserChange | null;
  if (!afterValue) return null;

  if (!beforeValue) {
    return `${afterValue.name} (${afterValue.email})`;
  }

  const parts: string[] = [];
  if (beforeValue.role !== afterValue.role) {
    const oldRole = beforeValue.role ? (ROLE_LABELS[beforeValue.role as keyof typeof ROLE_LABELS] ?? beforeValue.role) : "-";
    const newRole = afterValue.role ? (ROLE_LABELS[afterValue.role as keyof typeof ROLE_LABELS] ?? afterValue.role) : "-";
    parts.push(`Rol: ${oldRole} → ${newRole}`);
  }
  if (beforeValue.isActive !== afterValue.isActive) {
    parts.push(`Durum: ${beforeValue.isActive ? "Aktif" : "Pasif"} → ${afterValue.isActive ? "Aktif" : "Pasif"}`);
  }
  if (beforeValue.email !== afterValue.email) {
    parts.push(`E-posta: ${beforeValue.email} → ${afterValue.email}`);
  }
  if (afterValue.passwordChanged) {
    parts.push("Şifre değiştirildi");
  }

  return parts.length > 0 ? parts.join("; ") : `${afterValue.name} (${afterValue.email})`;
}

export default async function DenetimKayitlariPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const user = await requireOrganizationRoleOrRedirect(
    "manageUsers",
    "/panel",
    "Bu sayfaya erişim yetkiniz bulunmuyor."
  );
  const { page: pageParam } = await searchParams;
  const page = parsePageParam(pageParam);

  const where = { organizationId: user.organizationId };
  const [auditLogs, totalCount] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      select: {
        id: true,
        createdAt: true,
        action: true,
        entity: true,
        before: true,
        after: true,
        user: { select: { name: true } },
      },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * DEFAULT_PAGE_SIZE,
      take: DEFAULT_PAGE_SIZE,
    }),
    prisma.auditLog.count({ where }),
  ]);

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
          <CardDescription>{totalCount} kayıt.</CardDescription>
        </CardHeader>
        <CardContent>
          {auditLogs.length === 0 ? (
            <EmptyState
              icon={History}
              title="Henüz bir denetim kaydı bulunmuyor."
              description="Sistemde yapılan oluşturma, güncelleme ve silme işlemleri burada listelenecek."
            />
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
                  let detail: string | null = null;
                  if (log.entity === "DutyAssignment") {
                    detail = describeDutyAssignmentChange(log.before, log.after);
                  } else if (log.entity === "DutySchedule") {
                    detail = describeDutyScheduleChange(log.before, log.after);
                  } else if (log.entity === "User") {
                    detail = describeUserChange(log.before, log.after);
                  }

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
          <Pagination
            basePath="/denetim-kayitlari"
            searchParams={{}}
            page={page}
            pageSize={DEFAULT_PAGE_SIZE}
            totalCount={totalCount}
          />
        </CardContent>
      </Card>
    </div>
  );
}
