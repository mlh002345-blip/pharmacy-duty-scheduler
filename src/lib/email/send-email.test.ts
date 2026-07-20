import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sendMail = vi.fn();
const createTransport = vi.fn((_options: unknown) => ({ sendMail }));

vi.mock("nodemailer", () => ({
  default: { createTransport: (options: unknown) => createTransport(options) },
}));

const ENV_KEYS = ["SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASS", "SMTP_FROM"] as const;
const originalEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  vi.resetModules();
  sendMail.mockReset();
  createTransport.mockClear();
  for (const key of ENV_KEYS) {
    originalEnv[key] = process.env[key];
    delete process.env[key];
  }
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (originalEnv[key] === undefined) delete process.env[key];
    else process.env[key] = originalEnv[key];
  }
});

describe("sendEmail", () => {
  it("returns delivered:false without throwing or calling nodemailer when SMTP env vars are unset", async () => {
    const { sendEmail } = await import("./send-email");

    const result = await sendEmail({ to: "a@b.test", subject: "S", html: "<p>x</p>", text: "x" });

    expect(result).toEqual({ ok: true, delivered: false, reason: "smtp_not_configured" });
    expect(createTransport).not.toHaveBeenCalled();
  });

  it("sends via the configured SMTP transport when env vars are set", async () => {
    process.env.SMTP_HOST = "smtp.example.test";
    process.env.SMTP_PORT = "587";
    process.env.SMTP_USER = "user@example.test";
    process.env.SMTP_PASS = "secret";
    process.env.SMTP_FROM = "Nöbet Sistemi <noreply@example.test>";
    sendMail.mockResolvedValue({ messageId: "1" });

    const { sendEmail } = await import("./send-email");
    const result = await sendEmail({
      to: "eczane@ornek.test",
      subject: "Nöbet Hatırlatması",
      html: "<p>x</p>",
      text: "x",
    });

    expect(result).toEqual({ ok: true, delivered: true });
    expect(sendMail).toHaveBeenCalledWith(
      expect.objectContaining({ to: "eczane@ornek.test", from: "Nöbet Sistemi <noreply@example.test>" })
    );
  });

  it("returns a generic failure without leaking the underlying SMTP error", async () => {
    process.env.SMTP_HOST = "smtp.example.test";
    process.env.SMTP_PORT = "587";
    process.env.SMTP_USER = "user@example.test";
    process.env.SMTP_PASS = "secret";
    sendMail.mockRejectedValue(new Error("535 authentication failed"));

    const { sendEmail } = await import("./send-email");
    const result = await sendEmail({ to: "a@b.test", subject: "S", html: "<p>x</p>", text: "x" });

    expect(result).toEqual({ ok: false, reason: "send_failed" });
  });
});
