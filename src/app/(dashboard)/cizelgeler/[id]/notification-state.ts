// Bildirim önizleme useActionState durumu (yalnızca tipler ve başlangıç
// değeri; "use server" kısıtı nedeniyle ayrı modül).

export type NotificationPreviewChannel = "ALL" | "SMS" | "EMAIL";

export type NotificationPreviewStateRow = {
  pharmacyName: string;
  dutyDates: string[];
  phone: string | null;
  email: string | null;
  smsMessage: string;
  emailSubject: string;
  emailMessage: string;
};

export type NotificationActionState = {
  success: boolean;
  message: string;
  channel?: NotificationPreviewChannel;
  rows?: NotificationPreviewStateRow[];
  summary?: {
    smsReady: number;
    emailReady: number;
    missingPhone: number;
    missingEmail: number;
  };
};

export const initialNotificationState: NotificationActionState = {
  success: false,
  message: "",
};
