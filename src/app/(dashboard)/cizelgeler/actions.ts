"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/current-user";
import { writeAuditLog } from "@/lib/audit";
import { redirectWithMessage } from "@/lib/flash-redirect";
import { createDutyScheduleSchema } from "@/lib/validations/duty-schedule";
import { type ActionState, zodErrorState } from "@/lib/action-state";
import {
  DutyScheduleGenerationError,
  generateAndSaveDutySchedule,
} from "@/lib/scheduling/generate-and-save-duty-schedule";

export async function createDutyScheduleAction(
  _prevState: ActionState,
  formData: FormData
): Promise<ActionState> {
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

  const existing = await prisma.dutySchedule.findUnique({
    where: { year_month_regionId: { year, month, regionId } },
  });
  if (existing) {
    return {
      success: false,
      message: "Lütfen formdaki hataları düzeltin.",
      errors: {
        regionId: [
          "Bu bölge için seçilen ay ve yılda zaten bir nöbet çizelgesi mevcut.",
        ],
      },
    };
  }

  let scheduleId: string;
  try {
    const schedule = await generateAndSaveDutySchedule({ month, year, regionId });
    scheduleId = schedule.id;
  } catch (error) {
    if (error instanceof DutyScheduleGenerationError) {
      return { success: false, message: error.message };
    }
    throw error;
  }

  const userId = await getCurrentUserId();
  await writeAuditLog({
    userId,
    action: "CREATE",
    entity: "DutySchedule",
    entityId: scheduleId,
    after: { month, year, regionId, status: "DRAFT" },
  });

  revalidatePath("/cizelgeler");
  redirect(
    `/cizelgeler/${scheduleId}?success=${encodeURIComponent(
      "Taslak olarak oluşturuldu."
    )}`
  );
}

export async function deleteDutyScheduleAction(id: string) {
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

  await prisma.$transaction([
    prisma.dutyScheduleWarning.deleteMany({ where: { scheduleId: id } }),
    prisma.dutyAssignment.deleteMany({ where: { dutyScheduleId: id } }),
    prisma.dutySchedule.delete({ where: { id } }),
  ]);

  const userId = await getCurrentUserId();
  await writeAuditLog({
    userId,
    action: "DELETE",
    entity: "DutySchedule",
    entityId: id,
    before: schedule,
  });

  revalidatePath("/cizelgeler");
  redirectWithMessage("/cizelgeler", "success", "Nöbet çizelgesi silindi.");
}

export async function publishDutyScheduleAction(id: string) {
  const schedule = await prisma.dutySchedule.findUnique({ where: { id } });
  if (!schedule) {
    redirectWithMessage("/cizelgeler", "error", "Nöbet çizelgesi bulunamadı.");
  }
  if (schedule.status === "PUBLISHED") {
    redirectWithMessage(`/cizelgeler/${id}`, "error", "Çizelge zaten yayında.");
  }

  const updated = await prisma.dutySchedule.update({
    where: { id },
    data: { status: "PUBLISHED" },
  });

  const userId = await getCurrentUserId();
  await writeAuditLog({
    userId,
    action: "UPDATE",
    entity: "DutySchedule",
    entityId: id,
    before: { status: schedule.status },
    after: { status: updated.status },
  });

  revalidatePath(`/cizelgeler/${id}`);
  revalidatePath("/cizelgeler");
  revalidatePath("/vatandas");
  redirectWithMessage(`/cizelgeler/${id}`, "success", "Çizelge Yayınlandı.");
}

export async function unpublishDutyScheduleAction(id: string) {
  const schedule = await prisma.dutySchedule.findUnique({ where: { id } });
  if (!schedule) {
    redirectWithMessage("/cizelgeler", "error", "Nöbet çizelgesi bulunamadı.");
  }
  if (schedule.status === "DRAFT") {
    redirectWithMessage(`/cizelgeler/${id}`, "error", "Çizelge zaten taslak durumunda.");
  }

  const updated = await prisma.dutySchedule.update({
    where: { id },
    data: { status: "DRAFT" },
  });

  const userId = await getCurrentUserId();
  await writeAuditLog({
    userId,
    action: "UPDATE",
    entity: "DutySchedule",
    entityId: id,
    before: { status: schedule.status },
    after: { status: updated.status },
  });

  revalidatePath(`/cizelgeler/${id}`);
  revalidatePath("/cizelgeler");
  revalidatePath("/vatandas");
  redirectWithMessage(`/cizelgeler/${id}`, "success", "Çizelge Yayından Kaldırıldı.");
}
