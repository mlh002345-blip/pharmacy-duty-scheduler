import { z } from "zod";

// zod's .url() only checks syntax, not scheme — javascript:/data:/vbscript:
// all pass it. Any URL stored here can end up as an <a href> on public
// pages (e.g. Pharmacy.mapUrl on /vatandas), so only http/https are safe to
// accept.
export function isSafeHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

export function safeHttpUrlSchema(
  message = "Geçerli bir bağlantı giriniz (yalnızca http:// veya https://)."
) {
  return z.string().trim().refine(isSafeHttpUrl, message);
}
