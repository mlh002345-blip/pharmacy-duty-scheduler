// Saf (DB'siz) birim testleri: ortam değişkeni okuma, doğrulama ve mesaj
// üretimi. Gerçek Postgres'e karşı yaşam döngüsü testleri
// tests/integration/create-platform-admin.integration.test.ts içindedir.
import { describe, expect, it } from "vitest";

import {
  PlatformAdminBootstrapError,
  formatResultMessage,
  platformAdminInputSchema,
  readEnvInput,
} from "./create-platform-admin";

describe("readEnvInput", () => {
  it("rejects a missing PLATFORM_ADMIN_EMAIL", () => {
    expect(() =>
      readEnvInput({ PLATFORM_ADMIN_PASSWORD: "long-enough-password" })
    ).toThrow(PlatformAdminBootstrapError);
    expect(() =>
      readEnvInput({ PLATFORM_ADMIN_PASSWORD: "long-enough-password" })
    ).toThrow(/PLATFORM_ADMIN_EMAIL/);
  });

  it("rejects a missing PLATFORM_ADMIN_PASSWORD without echoing anything secret", () => {
    try {
      readEnvInput({ PLATFORM_ADMIN_EMAIL: "platform@example.org" });
      expect.unreachable("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(PlatformAdminBootstrapError);
      expect((error as Error).message).toContain("PLATFORM_ADMIN_PASSWORD");
    }
  });

  it("defaults the name when PLATFORM_ADMIN_NAME is absent or blank", () => {
    const withoutName = readEnvInput({
      PLATFORM_ADMIN_EMAIL: "platform@example.org",
      PLATFORM_ADMIN_PASSWORD: "long-enough-password",
      PLATFORM_ADMIN_NAME: "   ",
    });
    expect(withoutName.name).toBeUndefined();
    expect(
      platformAdminInputSchema.parse(withoutName).name
    ).toBe("Platform Yöneticisi");
  });

  it("passes an explicit PLATFORM_ADMIN_NAME through", () => {
    const input = readEnvInput({
      PLATFORM_ADMIN_EMAIL: "platform@example.org",
      PLATFORM_ADMIN_PASSWORD: "long-enough-password",
      PLATFORM_ADMIN_NAME: "Gerçek İsim",
    });
    expect(platformAdminInputSchema.parse(input).name).toBe("Gerçek İsim");
  });
});

describe("platformAdminInputSchema", () => {
  it("rejects a password shorter than the current 8-character policy", () => {
    const result = platformAdminInputSchema.safeParse({
      email: "platform@example.org",
      password: "kisa",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((issue) => issue.message).join(" ");
      expect(messages).toContain("en az 8 karakter");
      // Doğrulama mesajı girilen şifreyi asla içermez.
      expect(messages).not.toContain("kisa");
    }
  });

  it("rejects an invalid email", () => {
    const result = platformAdminInputSchema.safeParse({
      email: "not-an-email",
      password: "long-enough-password",
    });
    expect(result.success).toBe(false);
  });

  it("normalizes the email to lowercase", () => {
    const parsed = platformAdminInputSchema.parse({
      email: "  Platform@Example.ORG ",
      password: "long-enough-password",
    });
    expect(parsed.email).toBe("platform@example.org");
  });
});

describe("formatResultMessage", () => {
  it("never includes anything but the outcome and the email", () => {
    expect(
      formatResultMessage({ outcome: "created", email: "platform@example.org" })
    ).toBe("PLATFORM_ADMIN oluşturuldu: platform@example.org");
    expect(
      formatResultMessage({
        outcome: "already-exists",
        email: "platform@example.org",
      })
    ).toContain("Hiçbir değişiklik yapılmadı");
  });
});
