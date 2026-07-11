import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { logger, toSafeError } from "./logger";

describe("logger", () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let infoSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
  });

  afterEach(() => {
    errorSpy.mockRestore();
    warnSpy.mockRestore();
    infoSpy.mockRestore();
  });

  it("emits valid, one-line structured JSON with timestamp/level/event", () => {
    logger.info("test_event", { userId: "u1" });

    expect(infoSpy).toHaveBeenCalledOnce();
    const line = infoSpy.mock.calls[0][0] as string;
    expect(line.split("\n")).toHaveLength(1);
    const record = JSON.parse(line);
    expect(record.event).toBe("test_event");
    expect(record.level).toBe("info");
    expect(typeof record.timestamp).toBe("string");
    expect(new Date(record.timestamp).toString()).not.toBe("Invalid Date");
    expect(record.userId).toBe("u1");
  });

  it("uses console.error for level error", () => {
    logger.error("test_event");
    expect(errorSpy).toHaveBeenCalledOnce();
    expect(warnSpy).not.toHaveBeenCalled();
    expect(infoSpy).not.toHaveBeenCalled();
  });

  it("uses console.warn for level warn", () => {
    logger.warn("test_event");
    expect(warnSpy).toHaveBeenCalledOnce();
    expect(errorSpy).not.toHaveBeenCalled();
    expect(infoSpy).not.toHaveBeenCalled();
  });

  it("uses console.info for level info", () => {
    logger.info("test_event");
    expect(infoSpy).toHaveBeenCalledOnce();
    expect(errorSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("redacts context keys matching password/token/cookie/authorization/secret/databaseUrl", () => {
    logger.warn("test_event", {
      password: "hunter2",
      userToken: "abc123",
      sessionCookie: "cookie-value",
      Authorization: "Bearer xyz",
      apiSecret: "shh",
      DATABASE_URL: "postgresql://user:pass@host/db",
      userId: "u1",
    });

    const record = JSON.parse(warnSpy.mock.calls[0][0] as string);
    expect(record.password).toBe("[REDACTED]");
    expect(record.userToken).toBe("[REDACTED]");
    expect(record.sessionCookie).toBe("[REDACTED]");
    expect(record.Authorization).toBe("[REDACTED]");
    expect(record.apiSecret).toBe("[REDACTED]");
    expect(record.DATABASE_URL).toBe("[REDACTED]");
    // Non-sensitive keys pass through untouched.
    expect(record.userId).toBe("u1");
  });

  it("never leaks a redacted value's original content anywhere in the emitted line", () => {
    logger.error("test_event", { password: "hunter2-super-secret" });
    const line = errorSpy.mock.calls[0][0] as string;
    expect(line).not.toContain("hunter2-super-secret");
  });

  it("never throws when a context value can't be serialized (circular reference)", () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;

    expect(() => {
      // @ts-expect-error deliberately passing an unsafe/unsupported value shape
      logger.error("test_event", { bad: circular });
    }).not.toThrow();
  });

  it("never throws when console itself throws", () => {
    errorSpy.mockImplementation(() => {
      throw new Error("console is broken");
    });

    expect(() => logger.error("test_event")).not.toThrow();
  });

  describe("toSafeError", () => {
    it("extracts only name/code/message from an Error-shaped value", () => {
      const error = Object.assign(new Error("Something failed"), { code: "P2002" });
      const safe = toSafeError(error);
      expect(safe.name).toBe("Error");
      expect(safe.code).toBe("P2002");
      expect(safe.message).toBe("Something failed");
    });

    it("truncates a long message instead of including it in full", () => {
      const longMessage = "x".repeat(500);
      const safe = toSafeError(new Error(longMessage));
      expect(safe.message!.length).toBeLessThan(500);
    });

    it("does not include a stack trace field", () => {
      const safe = toSafeError(new Error("boom"));
      expect((safe as Record<string, unknown>).stack).toBeUndefined();
    });

    it("returns an empty object for non-object values", () => {
      expect(toSafeError(42)).toEqual({});
      expect(toSafeError(null)).toEqual({});
      expect(toSafeError(undefined)).toEqual({});
    });
  });

  it("includes a safe-error object on the record when an error is passed", () => {
    logger.error("test_event", { userId: "u1" }, new Error("db down"));
    const record = JSON.parse(errorSpy.mock.calls[0][0] as string);
    expect(record.error.message).toBe("db down");
    expect(record.error.name).toBe("Error");
  });

  // Step 6 (DB resilience chaos testing,
  // docs/security/24-db-resilience-connection-pool-validation.md)
  // requires that no log line generated while handling a real
  // PostgreSQL/Prisma connection failure ever contains DATABASE_URL,
  // credentials, or SQL parameter values — verified here against a
  // realistic Prisma connection-error shape, not just a context key.
  describe("redaction under real DB-connection-error shapes", () => {
    it("never leaks a connection string embedded in a Prisma-style error message", () => {
      const secretUrl = "postgresql://app:sUp3rSecret@db.internal:5432/pharmacy_duty_scheduler";
      const prismaLikeError = Object.assign(
        new Error(
          `Can't reach database server at db.internal:5432 (tried ${secretUrl}). Please make sure your database server is running.`
        ),
        { name: "PrismaClientInitializationError", code: "P1001" }
      );

      logger.error("database_read_failed", { requestId: "r1" }, prismaLikeError);

      const line = errorSpy.mock.calls[0][0] as string;
      expect(line).not.toContain("sUp3rSecret");
      expect(line).not.toContain("postgresql://");
    });

    it("never leaks a raw connection string passed directly as a log context value", () => {
      logger.error("database_connection_recovered", {
        requestId: "r1",
        // A caller mistakenly passing the connection string under a
        // non-obviously-sensitive key must still be caught — the actual
        // call sites in this app never do this (sanitizedDatabaseIdentifier
        // is always used instead), but the logger's own redaction must
        // not depend on every call site getting the key name right for
        // the *known* sensitive key patterns it already matches.
        databaseUrl: "postgresql://app:sUp3rSecret@db.internal:5432/pharmacy_duty_scheduler",
      });

      const line = errorSpy.mock.calls[0][0] as string;
      expect(line).not.toContain("sUp3rSecret");
    });

    it("truncates a very long Prisma error message rather than including it in full", () => {
      const secretUrl = "postgresql://app:sUp3rSecret@db.internal:5432/pharmacy_duty_scheduler";
      // Padding placed *before* the secret so a naive fixed-length
      // truncation could still leak it if truncation happened at the end
      // instead of bounding the whole message.
      const padded = "x".repeat(300) + secretUrl;
      const safe = toSafeError(new Error(padded));
      expect(safe.message!.length).toBeLessThanOrEqual(200);
    });
  });
});
