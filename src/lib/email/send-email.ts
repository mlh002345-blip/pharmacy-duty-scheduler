import nodemailer, { type Transporter } from "nodemailer";

export type SendEmailResult =
  | { ok: true; delivered: true }
  | { ok: true; delivered: false; reason: "smtp_not_configured" }
  | { ok: false; reason: "send_failed" };

export type SendEmailInput = {
  to: string;
  subject: string;
  html: string;
  text: string;
};

let cachedTransporter: Transporter | null | undefined;

// SMTP yapılandırması ortam değişkenlerinden gelir (SMTP_HOST/PORT/USER/
// PASS/FROM) — hiçbir sağlayıcıya bağımlı değildir, herhangi bir SMTP
// sunucusuyla (kurumsal posta, Gmail, üçüncü parti e-posta servisleri vb.)
// çalışır. Yapılandırılmamışsa (yerel geliştirme, henüz kurulmamış bir
// dağıtım) transporter oluşturulmaz — gönderim sessizce "delivered: false"
// döner, uygulama asla bu yüzden çökmez.
function getTransporter(): Transporter | null {
  if (cachedTransporter !== undefined) return cachedTransporter;

  const host = process.env.SMTP_HOST;
  const port = process.env.SMTP_PORT;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!host || !port || !user || !pass) {
    cachedTransporter = null;
    return null;
  }

  cachedTransporter = nodemailer.createTransport({
    host,
    port: Number(port),
    secure: Number(port) === 465,
    auth: { user, pass },
  });
  return cachedTransporter;
}

export async function sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
  const transporter = getTransporter();
  if (!transporter) {
    return { ok: true, delivered: false, reason: "smtp_not_configured" };
  }

  const from = process.env.SMTP_FROM || process.env.SMTP_USER;
  try {
    await transporter.sendMail({
      from,
      to: input.to,
      subject: input.subject,
      html: input.html,
      text: input.text,
    });
    return { ok: true, delivered: true };
  } catch {
    // Ayrıntılı hata (SMTP yanıtı, kimlik bilgisi ipuçları vb.) hiçbir
    // zaman çağırana veya kullanıcıya sızdırılmaz — yalnızca genel bir
    // başarısızlık sinyali döner.
    return { ok: false, reason: "send_failed" };
  }
}
