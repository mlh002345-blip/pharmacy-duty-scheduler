import { describe, expect, it } from "vitest";

import { validateEnv } from "./env";

describe("validateEnv", () => {
  it("rejects a missing DATABASE_URL in development", () => {
    expect(() => validateEnv({ NODE_ENV: "development" })).toThrow(
      "Missing required environment variable: DATABASE_URL"
    );
  });

  it("rejects a missing DATABASE_URL in production", () => {
    expect(() => validateEnv({ NODE_ENV: "production" })).toThrow(
      "Missing required environment variable: DATABASE_URL"
    );
  });

  it("does not require DATABASE_URL in test (vitest doesn't load .env, and prisma is always mocked)", () => {
    expect(() => validateEnv({ NODE_ENV: "test" })).not.toThrow();
    expect(validateEnv({ NODE_ENV: "test" }).databaseUrl).toBeUndefined();
  });

  it("rejects a SQLite/file-style DATABASE_URL in production", () => {
    expect(() =>
      validateEnv({ NODE_ENV: "production", DATABASE_URL: "file:./dev.db" })
    ).toThrow("Invalid DATABASE_URL for production: expected a PostgreSQL connection string.");
  });

  it("accepts a postgresql:// DATABASE_URL in production", () => {
    const result = validateEnv({
      NODE_ENV: "production",
      DATABASE_URL: "postgresql://user:pass@host:5432/db?schema=public",
    });
    expect(result.nodeEnv).toBe("production");
    expect(result.databaseUrl).toBe("postgresql://user:pass@host:5432/db?schema=public");
  });

  it("accepts a postgres:// DATABASE_URL in production", () => {
    expect(() =>
      validateEnv({ NODE_ENV: "production", DATABASE_URL: "postgres://user:pass@host:5432/db" })
    ).not.toThrow();
  });

  it("allows a SQLite/file-style DATABASE_URL in development (kept flexible for local dev)", () => {
    expect(() =>
      validateEnv({ NODE_ENV: "development", DATABASE_URL: "file:./dev.db" })
    ).not.toThrow();
  });

  it("defaults to development when NODE_ENV is unset", () => {
    expect(validateEnv({ DATABASE_URL: "file:./dev.db" }).nodeEnv).toBe("development");
  });

  it("rejects an invalid NODE_ENV value", () => {
    expect(() => validateEnv({ NODE_ENV: "staging" })).toThrow(
      "Invalid NODE_ENV: expected one of development, test, production."
    );
  });

  it("error messages never include the DATABASE_URL value itself", () => {
    const secretUrl = "postgresql://admin:SuperSecretPass123@prod-host:5432/db";
    try {
      validateEnv({ NODE_ENV: "production", DATABASE_URL: `file:${secretUrl}` });
      throw new Error("expected validateEnv to throw");
    } catch (error) {
      expect((error as Error).message).not.toContain("SuperSecretPass123");
      expect((error as Error).message).not.toContain(secretUrl);
    }
  });
});
