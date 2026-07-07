"use server";

import { requirePermissionOrState } from "@/lib/auth/guard";
import { redirectWithMessage } from "@/lib/flash-redirect";
import {
  NotificationServiceError,
  previewScheduleNotifications,
  simulateScheduleNotifications,
} from "@/lib/notifications/service";
import type {
  NotificationActionState,
  NotificationPreviewChannel,
} from "./notification-state";

export async function previewNotificationsAction(
  scheduleId: string,
  _state: NotificationActionState,
  formData: FormData
): Promise<NotificationActionState> {
  const guard = await requirePermissionOrState("publishSchedule");
  if (!guard.user) return { success: false, message: guard.state.message };

  const channelValue = formData.get("channel");
  const channel: NotificationPreviewChannel =
    channelValue === "SMS" || channelValue === "EMAIL" ? channelValue : "ALL";

  try {
    const preview = await previewScheduleNotifications(scheduleId);
    return {
      success: true,
      message: `${preview.monthYearLabel} bildirimleri önizlendi. Gerçek gönderim yapılmadı.`,
      channel,
      rows: preview.rows.map((row) => ({
        pharmacyName: row.pharmacyName,
        dutyDates: row.dutyDates,
        phone: row.phone,
        email: row.email,
        smsMessage: row.smsMessage,
        emailSubject: row.emailSubject,
        emailMessage: row.emailMessage,
      })),
      summary: {
        smsReady: preview.smsReady,
        emailReady: preview.emailReady,
        missingPhone: preview.missingPhone,
        missingEmail: preview.missingEmail,
      },
    };
  } catch (error) {
    if (error instanceof NotificationServiceError) {
      return { success: false, message: error.message };
    }
    throw error;
  }
}

export async function simulateNotificationsAction(scheduleId: string) {
  const guard = await requirePermissionOrState("publishSchedule");
  if (!guard.user) {
    redirectWithMessage(
      `/cizelgeler/${scheduleId}`,
      "error",
      "Bu işlem için yetkiniz bulunmuyor."
    );
  }

  try {
    const result = await simulateScheduleNotifications(scheduleId, guard.user.id);
    redirectWithMessage(
      `/cizelgeler/${scheduleId}`,
      "success",
      `Bildirim simülasyonu tamamlandı. Gerçek SMS/e-posta gönderilmedi. (${result.simulated} bildirim simüle edildi, ${result.skipped} kayıt eksik iletişim bilgisi nedeniyle atlandı.)`
    );
  } catch (error) {
    if (error instanceof NotificationServiceError) {
      redirectWithMessage(`/cizelgeler/${scheduleId}`, "error", error.message);
    }
    throw error;
  }
}
