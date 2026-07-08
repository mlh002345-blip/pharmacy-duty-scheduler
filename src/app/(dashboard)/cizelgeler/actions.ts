"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { requirePermissionOrRedirect, requirePermissionOrState } from "@/lib/auth/guard";
import { writeAuditLog } from "@/lib/audit";
import { redirectWithMessage } from "@/lib/flash-redirect";
import { createDutyScheduleSchema } from "@/lib/validations/duty-schedule";
import { type ActionState, zodErrorState } from "@/lib/action-state";
import {
  DutyScheduleGenerationError,
  generateAndSaveDutySchedule,
} from "@/lib/scheduling/generate-and-save-duty-schedule";
import { findScheduleConflicts } from "@/lib/scheduling/duty-assignment-edit";
import { getSchedulePreCheck } from "@/lib/scheduling/schedule-precheck";

export async function createDutyScheduleAction(
  _prevState: ActionState,
  formData: FormData
): Promise<ActionState> {
  const guard = await requirePermissionOrState("generateSchedule");
  if (!guard.user) return guard.state;
  const { user } = guard;

  const parsed = createDutyScheduleSchema.safeParse({
    month: formData.get("month"),
    year: formData.get("year"),
    regionId: formData.get("regionId"),
  });

  if (!parsed.success) {
    return zodErrorState(parsed.error, "Lütfen formdaki hataları düzeltin.");
  }

  const { month, year, regionId } = parsed.data;

  const region = await prisma.region.findUnique({
    where: { id: regionId },
    include: {
      dutyRule: true,
      pharmacies: { where: { isActive: true }, select: { id: true } },
    },
  });

  if (!region) {
    return {
      success: false,
      message: "Lütfen formdaki hataları düzeltin.",
      errors: { regionId: ["Seçilen bölge bulunamadı."] },
    };
  }
  if (!region.dutyRule) {
    return {
      success: false,
      message: "Lütfen formdaki hataları düzeltin.",
      errors: {
        regionId: ["Bu bölge için tanımlı bir nöbet kuralı bulunmuyor."],
      },
    };
  }
  if (region.pharmacies.length === 0) {
    return {
      success: false,
      message: "Lütfen formdaki hataları düzeltin.",
      errors: { regionId: ["Bu bölgede aktif eczane bulunmuyor."] },
    };
  }

  const duplicateScheduleState: ActionState = {
    success: false,
    message: "Lütfen formdaki hataları düzeltin.",
    errors: {
      regionId: [
        "Bu bölge için seçilen ay ve yılda zaten bir nöbet çizelgesi mevcut.",
      ],
    },
  };

  const existing = await prisma.dutySchedule.findUnique({
    where: { year_month_regionId: { year, month, regionId } },
  });
  if (existing) {
    return duplicateScheduleState;
  }

  const preCheck = await getSchedulePreCheck({
    regionId,
    month,
    year,
    dailyDutyCount: region.dailyDutyCount,
    hasDutyRule: !!region.dutyRule,
    activePharmacyIds: region.pharmacies.map((p) => p.id),
  });
  if (!preCheck.canGenerate) {
    return {
      success: false,
      message: preCheck.criticalErrors.join(" "),
    };
  }

  let scheduleId: string;
  let infoMessages: string[];
  try {
    const result = await generateAndSaveDutySchedule({ month, year, regionId, userId: user.id });
    scheduleId = result.schedule.id;
    infoMessages = [...preCheck.warnings, ...result.info];
  } catch (error) {
    if (error instanceof DutyScheduleGenerationError) {
      return { success: false, message: error.message };
    }
    // İki eşzamanlı istek aynı bölge/ay/yıl için çizelge oluşturmaya
    // çalışırsa (ör. çift tıklama), yukarıdaki `existing` kontrolünü ikisi de
    // geçebilir; ikinci yazma DB'nin benzersizlik kısıtına (year_month_regionId)
    // çarpar. Bu işlemin yazdığı tek benzersiz alan bu olduğundan, P2002'yi
    // doğrudan sıralı durumla aynı Türkçe mesaja eşleyip kullanıcıya ham bir
    // hata sayfası yerine anlaşılır bir yanıt döndürüyoruz.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return duplicateScheduleState;
    }
    throw error;
  }

  revalidatePath("/cizelgeler");
  redirect(
    `/cizelgeler/${scheduleId}?success=${encodeURIComponent(
      ["Taslak olarak oluşturuldu.", ...infoMessages].join(" ")
    )}`
  );
}

export async function deleteDutyScheduleAction(id: string) {
  const user = await requirePermissionOrRedirect("deleteSchedule", "/cizelgeler");

  const schedule = await prisma.dutySchedule.findUnique({ where: { id } });
  if (!schedule) {
    redirectWithMessage("/cizelgeler", "error", "Nöbet çizelgesi bulunamadı.");
  }
  if (schedule.status === "PUBLISHED") {
    redirectWithMessage(
      "/cizelgeler",
      "error",
      "Yayında olan çizelge silinemez. Önce yayından kaldırın."
    );
  }

  await prisma.$transaction(async (tx) => {
    await tx.dutyScheduleWarning.deleteMany({ where: { scheduleId: id } });
    await tx.dutyAssignment.deleteMany({ where: { dutyScheduleId: id } });
    await tx.dutySchedule.delete({ where: { id } });
    await writeAuditLog(tx, {
      userId: user.id,
      action: "DELETE",
      entity: "DutySchedule",
      entityId: id,
      before: schedule,
    });
  });

  revalidatePath("/cizelgeler");
  redirectWithMessage("/cizelgeler", "success", "Nöbet çizelgesi silindi.");
}

export async function publishDutyScheduleAction(id: string) {
  const user = await requirePermissionOrRedirect("publishSchedule", `/cizelgeler/${id}`);

  const schedule = await prisma.dutySchedule.findUnique({
    where: { id },
    include: { assignments: { select: { id: true, pharmacyId: true, date: true } } },
  });
  if (!schedule) {
    redirectWithMessage("/cizelgeler", "error", "Nöbet çizelgesi bulunamadı.");
  }
  if (schedule.status === "PUBLISHED") {
    redirectWithMessage(`/cizelgeler/${id}`, "error", "Çizelge zaten yayında.");
  }

  const assignmentPharmacyIds = [...new Set(schedule.assignments.map((a) => a.pharmacyId))];
  const dutyRequests = await prisma.dutyRequest.findMany({
    where: { pharmacyId: { in: assignmentPharmacyIds } },
    select: { pharmacyId: true, requestType: true, status: true, startDate: true, endDate: true },
  });
  const conflicts = findScheduleConflicts({
    assignments: schedule.assignments,
    dutyRequests,
  });
  if (conflicts.length > 0) {
    redirectWithMessage(
      `/cizelgeler/${id}`,
      "error",
      "Bu çizelgede onaylı nöbet talebiyle çakışan atamalar bulunduğu için yayınlama yapılamaz. Lütfen çakışmaları giderin."
    );
  }

  await prisma.$transaction(async (tx) => {
    const updated = await tx.dutySchedule.update({
      where: { id },
      data: { status: "PUBLISHED" },
    });
    await writeAuditLog(tx, {
      userId: user.id,
      action: "UPDATE",
      entity: "DutySchedule",
      entityId: id,
      before: { status: schedule.status },
      after: { status: updated.status },
    });
  });

  revalidatePath(`/cizelgeler/${id}`);
  revalidatePath("/cizelgeler");
  revalidatePath("/vatandas");
  redirectWithMessage(`/cizelgeler/${id}`, "success", "Çizelge Yayınlandı.");
}

export async function unpublishDutyScheduleAction(id: string) {
  const user = await requirePermissionOrRedirect("publishSchedule", `/cizelgeler/${id}`);

  const schedule = await prisma.dutySchedule.findUnique({ where: { id } });
  if (!schedule) {
    redirectWithMessage("/cizelgeler", "error", "Nöbet çizelgesi bulunamadı.");
  }
  if (schedule.status === "DRAFT") {
    redirectWithMessage(`/cizelgeler/${id}`, "error", "Çizelge zaten taslak durumunda.");
  }

  await prisma.$transaction(async (tx) => {
    const updated = await tx.dutySchedule.update({
      where: { id },
      data: { status: "DRAFT" },
    });
    await writeAuditLog(tx, {
      userId: user.id,
      action: "UPDATE",
      entity: "DutySchedule",
      entityId: id,
      before: { status: schedule.status },
      after: { status: updated.status },
    });
  });

  revalidatePath(`/cizelgeler/${id}`);
  revalidatePath("/cizelgeler");
  revalidatePath("/vatandas");
  redirectWithMessage(`/cizelgeler/${id}`, "success", "Çizelge Yayından Kaldırıldı.");
}
