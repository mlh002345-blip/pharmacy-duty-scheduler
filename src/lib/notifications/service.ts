import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit";
import { getTurkishMonthName } from "@/lib/scheduling/date-tr";
import { buildEmailBody, buildEmailSubject, buildSmsMessage } from "./templates";

// Bildirim altyapısı: önizleme + simülasyon + log. Gerçek SMS/e-posta
// GÖNDERİLMEZ; sağlayıcı entegrasyonu için sendSmsNotification /
// sendEmailNotification yer tutucuları bilinçli olarak devre dışıdır.

export type NotificationPreviewRow = {
  pharmacyId: string;
  pharmacyName: string;
  dutyDates: string[];
  phone: string | null;
  email: string | null;
  smsMessage: string;
  emailSubject: string;
  emailMessage: string;
};

export type NotificationPreview = {
  scheduleId: string;
  monthYearLabel: string;
  regionName: string;
  rows: NotificationPreviewRow[];
  smsReady: number;
  emailReady: number;
  missingPhone: number;
  missingEmail: number;
};

export class NotificationServiceError extends Error {}

export async function previewScheduleNotifications(
  scheduleId: string
): Promise<NotificationPreview> {
  const schedule = await prisma.dutySchedule.findUnique({
    where: { id: scheduleId },
    select: {
      id: true,
      month: true,
      year: true,
      status: true,
      region: { select: { name: true } },
      assignments: {
        select: {
          date: true,
          pharmacy: {
            select: {
              id: true,
              name: true,
              phone: true,
              email: true,
              address: true,
            },
          },
        },
        orderBy: { date: "asc" },
      },
    },
  });
  if (!schedule) {
    throw new NotificationServiceError("Nöbet çizelgesi bulunamadı.");
  }
  if (schedule.status !== "PUBLISHED") {
    throw new NotificationServiceError(
      "Bildirim göndermek için çizelgeyi önce yayınlayın."
    );
  }

  const monthYearLabel = `${getTurkishMonthName(schedule.month)} ${schedule.year}`;

  // Eczane başına nöbet tarihlerini topla.
  const byPharmacy = new Map<
    string,
    { name: string; phone: string | null; email: string | null; address: string; dates: string[] }
  >();
  for (const assignment of schedule.assignments) {
    const { pharmacy } = assignment;
    const entry = byPharmacy.get(pharmacy.id) ?? {
      name: pharmacy.name,
      phone: pharmacy.phone?.trim() || null,
      email: pharmacy.email?.trim() || null,
      address: pharmacy.address,
      dates: [],
    };
    entry.dates.push(assignment.date.toLocaleDateString("tr-TR"));
    byPharmacy.set(pharmacy.id, entry);
  }

  const rows: NotificationPreviewRow[] = Array.from(byPharmacy.entries()).map(
    ([pharmacyId, entry]) => {
      const templateInput = {
        pharmacyName: entry.name,
        monthYearLabel,
        dutyDates: entry.dates,
        regionName: schedule.region.name,
        address: entry.address,
      };
      return {
        pharmacyId,
        pharmacyName: entry.name,
        dutyDates: entry.dates,
        phone: entry.phone,
        email: entry.email,
        smsMessage: buildSmsMessage(templateInput),
        emailSubject: buildEmailSubject(templateInput),
        emailMessage: buildEmailBody(templateInput),
      };
    }
  );
  rows.sort((a, b) => a.pharmacyName.localeCompare(b.pharmacyName, "tr"));

  return {
    scheduleId: schedule.id,
    monthYearLabel,
    regionName: schedule.region.name,
    rows,
    smsReady: rows.filter((r) => r.phone).length,
    emailReady: rows.filter((r) => r.email).length,
    missingPhone: rows.filter((r) => !r.phone).length,
    missingEmail: rows.filter((r) => !r.email).length,
  };
}

// Simülasyon: gerçek gönderim YAPMADAN NotificationLog kayıtları oluşturur.
// Eksik iletişim bilgisi olan eczaneler SKIPPED olarak loglanır.
export async function simulateScheduleNotifications(
  scheduleId: string,
  userId: string
): Promise<{ simulated: number; skipped: number }> {
  const preview = await previewScheduleNotifications(scheduleId);

  const logs = preview.rows.flatMap((row) => [
    {
      scheduleId,
      pharmacyId: row.pharmacyId,
      channel: "SMS" as const,
      recipient: row.phone ?? "-",
      message: row.smsMessage,
      status: row.phone ? ("SIMULATED" as const) : ("SKIPPED" as const),
      provider: "simulation",
      errorMessage: row.phone ? null : "Telefon bilgisi eksik.",
      sentById: userId,
      sentAt: row.phone ? new Date() : null,
    },
    {
      scheduleId,
      pharmacyId: row.pharmacyId,
      channel: "EMAIL" as const,
      recipient: row.email ?? "-",
      subject: row.emailSubject,
      message: row.emailMessage,
      status: row.email ? ("SIMULATED" as const) : ("SKIPPED" as const),
      provider: "simulation",
      errorMessage: row.email ? null : "E-posta bilgisi eksik.",
      sentById: userId,
      sentAt: row.email ? new Date() : null,
    },
  ]);

  await prisma.notificationLog.createMany({ data: logs });

  const simulated = logs.filter((log) => log.status === "SIMULATED").length;
  const skipped = logs.filter((log) => log.status === "SKIPPED").length;

  await writeAuditLog({
    userId,
    action: "CREATE",
    entity: "NotificationLog",
    entityId: scheduleId,
    after: { scheduleId, mode: "SIMULATION", simulated, skipped },
  });

  return { simulated, skipped };
}

// Gelecekteki sağlayıcı entegrasyonu için yer tutucular. Gerçek gönderim,
// açık ortam değişkeni yapılandırması olmadan asla etkinleştirilmemelidir.
export async function sendSmsNotification(): Promise<never> {
  throw new NotificationServiceError(
    "SMS sağlayıcısı yapılandırılmadı. Bu sürümde yalnızca önizleme ve simülasyon desteklenir."
  );
}

export async function sendEmailNotification(): Promise<never> {
  throw new NotificationServiceError(
    "E-posta sağlayıcısı yapılandırılmadı. Bu sürümde yalnızca önizleme ve simülasyon desteklenir."
  );
}
