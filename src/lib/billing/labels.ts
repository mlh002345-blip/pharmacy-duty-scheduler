import type { BillingStatus } from "@prisma/client";

export const BILLING_STATUS_LABELS: Record<BillingStatus, string> = {
  TRIAL: "Deneme",
  ACTIVE: "Ödeniyor",
  PAST_DUE: "Ödeme Gecikti",
  CANCELED: "İptal Edildi",
};

export const BILLING_STATUS_BADGE: Record<
  BillingStatus,
  "success" | "warning" | "destructive" | "secondary" | "info"
> = {
  TRIAL: "info",
  ACTIVE: "success",
  PAST_DUE: "warning",
  CANCELED: "destructive",
};

export const BILLING_STATUS_OPTIONS: BillingStatus[] = ["TRIAL", "ACTIVE", "PAST_DUE", "CANCELED"];
