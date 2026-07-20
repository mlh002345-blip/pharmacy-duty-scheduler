// Konum bazlı değil, iletişim odaklı yeni özellik: nöbet hatırlatma
// e-postası (bkz. src/lib/reminders/send-duty-reminders.ts), gerçek
// Postgres'e karşı. Bu ortamda SMTP yapılandırılmadığından sendEmail her
// zaman { ok: true, delivered: false, reason: "smtp_not_configured" }
// döner — yine de servisin asıl mantığı (hangi atamalar hedef, e-postası
// eksik olanlar, zaten gönderilmiş olanlar, reminderSentAt işaretlemesi,
// denetim kaydı) gerçek DB üzerinden uçtan uca doğrulanır.

import { afterEach, describe, expect, it } from "vitest";

import { prisma } from "@/lib/prisma";
import { sendDutyReminders } from "@/lib/reminders/send-duty-reminders";
import {
  createTestPharmacy,
  createTestRegion,
  createTestUser,
  cleanupTrackedIds,
  newTrackedIds,
} from "./helpers/fixtures";

describe("sendDutyReminders (real Postgres)", () => {
  const tracked = newTrackedIds();

  afterEach(async () => {
    await cleanupTrackedIds(tracked);
  });

  it("sends to every tomorrow-published assignment with an email, skips missing-email pharmacies, and marks reminderSentAt", async () => {
    const region = await createTestRegion(tracked);
    const admin = await createTestUser(tracked, { role: "ADMIN", organizationId: region.organizationId });
    const withEmail = await createTestPharmacy(tracked, region.id);
    await prisma.pharmacy.update({ where: { id: withEmail.id }, data: { email: "eczane@ornek.test" } });
    const withoutEmail = await createTestPharmacy(tracked, region.id);

    const schedule = await prisma.dutySchedule.create({
      data: { month: 9, year: 2031, regionId: region.id, status: "PUBLISHED" },
    });
    tracked.dutyScheduleIds.push(schedule.id);

    const tomorrow = new Date(Date.UTC(2031, 8, 16));
    const assignmentWithEmail = await prisma.dutyAssignment.create({
      data: { dutyScheduleId: schedule.id, date: tomorrow, pharmacyId: withEmail.id, weight: 1 },
    });
    await prisma.dutyAssignment.create({
      data: { dutyScheduleId: schedule.id, date: tomorrow, pharmacyId: withoutEmail.id, weight: 1 },
    });

    const result = await sendDutyReminders({
      organizationId: region.organizationId,
      userId: admin.id,
      targetDate: tomorrow,
    });

    expect(result).toEqual({
      ok: true,
      targetDate: "2031-09-16",
      sentCount: 1,
      missingEmailCount: 1,
      alreadySentCount: 0,
      failedCount: 0,
    });

    const updated = await prisma.dutyAssignment.findUnique({ where: { id: assignmentWithEmail.id } });
    expect(updated?.reminderSentAt).not.toBeNull();

    const auditRow = await prisma.auditLog.findFirst({
      where: { entity: "DutyAssignment", entityId: assignmentWithEmail.id, action: "UPDATE" },
    });
    expect(auditRow).not.toBeNull();
  });

  it("does not send a second reminder for an assignment already marked as sent", async () => {
    const region = await createTestRegion(tracked);
    const admin = await createTestUser(tracked, { role: "ADMIN", organizationId: region.organizationId });
    const pharmacy = await createTestPharmacy(tracked, region.id);
    await prisma.pharmacy.update({ where: { id: pharmacy.id }, data: { email: "eczane@ornek.test" } });

    const schedule = await prisma.dutySchedule.create({
      data: { month: 10, year: 2031, regionId: region.id, status: "PUBLISHED" },
    });
    tracked.dutyScheduleIds.push(schedule.id);

    const targetDate = new Date(Date.UTC(2031, 9, 5));
    await prisma.dutyAssignment.create({
      data: {
        dutyScheduleId: schedule.id,
        date: targetDate,
        pharmacyId: pharmacy.id,
        weight: 1,
        reminderSentAt: new Date(),
      },
    });

    const result = await sendDutyReminders({
      organizationId: region.organizationId,
      userId: admin.id,
      targetDate,
    });

    expect(result).toEqual({
      ok: true,
      targetDate: "2031-10-05",
      sentCount: 0,
      missingEmailCount: 0,
      alreadySentCount: 1,
      failedCount: 0,
    });
  });

  it("ignores DRAFT schedules and other organizations' assignments", async () => {
    const regionA = await createTestRegion(tracked);
    const regionB = await createTestRegion(tracked);
    const adminA = await createTestUser(tracked, { role: "ADMIN", organizationId: regionA.organizationId });
    const pharmacyA = await createTestPharmacy(tracked, regionA.id);
    await prisma.pharmacy.update({ where: { id: pharmacyA.id }, data: { email: "a@ornek.test" } });
    const pharmacyB = await createTestPharmacy(tracked, regionB.id);
    await prisma.pharmacy.update({ where: { id: pharmacyB.id }, data: { email: "b@ornek.test" } });

    const draftSchedule = await prisma.dutySchedule.create({
      data: { month: 11, year: 2031, regionId: regionA.id, status: "DRAFT" },
    });
    tracked.dutyScheduleIds.push(draftSchedule.id);
    const scheduleB = await prisma.dutySchedule.create({
      data: { month: 11, year: 2031, regionId: regionB.id, status: "PUBLISHED" },
    });
    tracked.dutyScheduleIds.push(scheduleB.id);

    const targetDate = new Date(Date.UTC(2031, 10, 3));
    await prisma.dutyAssignment.create({
      data: { dutyScheduleId: draftSchedule.id, date: targetDate, pharmacyId: pharmacyA.id, weight: 1 },
    });
    await prisma.dutyAssignment.create({
      data: { dutyScheduleId: scheduleB.id, date: targetDate, pharmacyId: pharmacyB.id, weight: 1 },
    });

    const result = await sendDutyReminders({
      organizationId: regionA.organizationId,
      userId: adminA.id,
      targetDate,
    });

    expect(result).toEqual({
      ok: true,
      targetDate: "2031-11-03",
      sentCount: 0,
      missingEmailCount: 0,
      alreadySentCount: 0,
      failedCount: 0,
    });
  });
});
