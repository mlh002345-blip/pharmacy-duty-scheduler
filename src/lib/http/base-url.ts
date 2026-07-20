import { headers } from "next/headers";

import { isTrustProxyHeadersEnabled } from "@/lib/security/client-identity";

// E-postaya gömülecek mutlak bağlantılar (ör. şifre sıfırlama) için taban
// URL. APP_URL açıkça ayarlanmışsa o kullanılır (en güvenilir yol —
// tersine proxy güvenine bağlı değildir). Ayarlanmamışsa, isteğin Host
// başlığından türetilir; protokol yalnızca TRUST_PROXY_HEADERS açıkken
// x-forwarded-proto'dan okunur (bkz. src/lib/security/client-identity.ts'in
// aynı bayrağı kullanan gerekçesi), aksi halde https varsayılır.
export async function getAppBaseUrl(): Promise<string> {
  const configured = process.env.APP_URL;
  if (configured) return configured.replace(/\/+$/, "");

  const headerList = await headers();
  const host = headerList.get("host") ?? "localhost:3000";
  const protocol =
    isTrustProxyHeadersEnabled() && headerList.get("x-forwarded-proto") === "http"
      ? "http"
      : host.startsWith("localhost") || host.startsWith("127.0.0.1")
        ? "http"
        : "https";
  return `${protocol}://${host}`;
}
