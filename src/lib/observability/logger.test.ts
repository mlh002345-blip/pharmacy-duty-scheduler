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
});
