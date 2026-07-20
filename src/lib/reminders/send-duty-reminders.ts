import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit";
import { sendEmail } from "@/lib/email/send-email";
import { addDays, getTurkishDayName, todayAtUtcMidnight } from "@/lib/scheduling/date-tr";

export type SendDutyRemindersResult = {
  ok: true;
  targetDate: string;
  sentCount: number;
  missingEmailCount: number;
  alreadySentCount: number;
  failedCount: number;
};

// Bir organizasyonun, hedef tarihte (varsayılan: yarın) YAYINLANMIŞ bir
// çizelgede nöbetçi olan ve e-postası tanımlı eczanelerine hatırlatma
// e-postası gönderir. Aynı atama için ikinci kez gönderilmez
// (DutyAssignment.reminderSentAt set edildikten sonra atlanır) — bu yüzden
// aynı gün birden fazla kez tetiklense de tekrar e-posta gitmez.
//
// Yalnızca manuel, panel içinden bir yönetici/oda yetkilisi tetiklemesiyle
// çalışır (bkz. src/app/(dashboard)/nobet-talepleri gibi diğer modüllerin
// aksine burada otomatik bir zamanlayıcı/cron entegrasyonu yok — Next.js'in
// kendi başına bir zamanlayıcısı olmadığından, bu bilinçli olarak dışarıda
// bırakıldı; harici bir cron bu servisi ileride çağırabilir).
export async function sendDutyReminders(params: {
  organizationId: string;
  userId: string;
  targetDate?: Date;
}): Promise<SendDutyRemindersResult> {
  const targetDate = params.targetDate ?? addDays(todayAtUtcMidnight(), 1);

  const allAssignments = await prisma.dutyAssignment.findMany({
    where: {
      date: targetDate,
      dutySchedule: {
        status: "PUBLISHED",
        region: { organizationId: params.organizationId },
      },
    },
    select: {
      id: true,
      reminderSentAt: true,
      pharmacy: { select: { id: true, name: true, email: true } },
      dutySchedule: { select: { region: { select: { name: true } } } },
    },
  });
  const alreadySentCount = allAssignments.filter((a) => a.reminderSentAt !== null).length;
  const assignments = allAssignments.filter((a) => a.reminderSentAt === null);

  let sentCount = 0;
  let missingEmailCount = 0;
  let failedCount = 0;

  const dayLabel = getTurkishDayName(targetDate);
  const dateLabel = targetDate.toLocaleDateString("tr-TR", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });

  for (const assignment of assignments) {
    if (!assignment.pharmacy.email) {
      missingEmailCount += 1;
      continue;
    }

    const result = await sendEmail({
      to: assignment.pharmacy.email,
      subject: `Nöbet Hatırlatması: ${dayLabel}, ${dateLabel}`,
      text: `Sayın ${assignment.pharmacy.name}, ${dayLabel} ${dateLabel} tarihinde ${assignment.dutySchedule.region.name} bölgesinde nöbetçisiniz.`,
      html: `<p>Sayın ${assignment.pharmacy.name},</p><p><strong>${dayLabel} ${dateLabel}</strong> tarihinde <strong>${assignment.dutySchedule.region.name}</strong> bölgesinde nöbetçisiniz.</p>`,
    });

    if (!result.ok) {
      failedCount += 1;
      continue;
    }

    await prisma.$transaction(async (tx) => {
      await tx.dutyAssignment.update({
        where: { id: assignment.id },
        data: { reminderSentAt: new Date() },
      });
      await writeAuditLog(tx, {
        organizationId: params.organizationId,
        userId: params.userId,
        action: "UPDATE",
        entity: "DutyAssignment",
        entityId: assignment.id,
        dutyAssignmentId: assignment.id,
        after: { reminderSentAt: true, delivered: result.delivered },
      });
    });
    sentCount += 1;
  }

  return {
    ok: true,
    targetDate: targetDate.toISOString().slice(0, 10),
    sentCount,
    missingEmailCount,
    alreadySentCount,
    failedCount,
  };
}
