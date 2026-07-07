import type { DutyRequestStatus, DutyRequestType, DutyRequestSource } from "@prisma/client";

export const DUTY_REQUEST_TYPE_LABELS: Record<DutyRequestType, string> = {
  CANNOT_DUTY: "Nöbet Tutamama",
  PREFER_DUTY: "Nöbet Tercihi",
  SWAP_REQUEST: "Nöbet Değişimi",
  EMERGENCY_EXCUSE: "Acil Mazeret",
};

export const DUTY_REQUEST_STATUS_LABELS: Record<DutyRequestStatus, string> = {
  PENDING: "Beklemede",
  APPROVED: "Onaylandı",
  REJECTED: "Reddedildi",
  CANCELLED: "İptal Edildi",
  LATE: "Geç Başvuru",
};

export const DUTY_REQUEST_SOURCE_LABELS: Record<DutyRequestSource, string> = {
  ADMIN_ENTRY: "Oda Girişi",
  PUBLIC_LINK: "Eczane Bağlantısı",
  IMPORT: "İçe Aktarma",
};

export const DUTY_REQUEST_STATUS_BADGE: Record<
  DutyRequestStatus,
  "success" | "warning" | "destructive" | "secondary" | "info"
> = {
  PENDING: "warning",
  APPROVED: "success",
  REJECTED: "destructive",
  CANCELLED: "secondary",
  LATE: "info",
};
