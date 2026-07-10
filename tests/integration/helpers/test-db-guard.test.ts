import { afterEach, describe, expect, it } from "vitest";

import {
  resolveRestoreDatabaseUrl,
  resolveTestDatabaseUrl,
  sanitizedDatabaseIdentifier,
} from "./test-db-guard";

// Pure/sync safety-guard logic — no database connection, no side effects
// beyond process.env reads, so this runs as a normal, fast unit test
// under `npm test` (see vitest.config.ts's exclude pattern) rather than
// requiring `npm run test:integration`.

const ORIGINAL_TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const ORIGINAL_RESTORE_DATABASE_URL = process.env.RESTORE_DATABASE_URL;
const ORIGINAL_DATABASE_URL = process.env.DATABASE_URL;

function restoreEnv() {
  if (ORIGINAL_TEST_DATABASE_URL === undefined) delete process.env.TEST_DATABASE_URL;
  else process.env.TEST_DATABASE_URL = ORIGINAL_TEST_DATABASE_URL;
  if (ORIGINAL_RESTORE_DATABASE_URL === undefined) delete process.env.RESTORE_DATABASE_URL;
  else process.env.RESTORE_DATABASE_URL = ORIGINAL_RESTORE_DATABASE_URL;
  if (ORIGINAL_DATABASE_URL === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = ORIGINAL_DATABASE_URL;
}

describe("resolveTestDatabaseUrl", () => {
  afterEach(() => {
    restoreEnv();
  });

  it("throws when TEST_DATABASE_URL is missing", () => {
    delete process.env.TEST_DATABASE_URL;
    process.env.DATABASE_URL = "postgresql://user:pass@prod-host:5432/pharmacy_duty_scheduler";
    expect(() => resolveTestDatabaseUrl()).toThrow(/TEST_DATABASE_URL is not set/);
  });

  it("throws when TEST_DATABASE_URL is byte-identical to DATABASE_URL", () => {
    const url = "postgresql://user:pass@localhost:5432/pharmacy_duty_scheduler";
    process.env.TEST_DATABASE_URL = url;
    process.env.DATABASE_URL = url;
    expect(() => resolveTestDatabaseUrl()).toThrow(/must not be the same value as DATABASE_URL/);
  });

  it("throws when TEST_DATABASE_URL resolves to the same host/db as DATABASE_URL despite different credentials/query params", () => {
    process.env.DATABASE_URL = "postgresql://app:secret1@db.internal:5432/pharmacy_test?sslmode=require";
    process.env.TEST_DATABASE_URL = "postgresql://other:secret2@db.internal:5432/pharmacy_test?schema=public";
    expect(() => resolveTestDatabaseUrl()).toThrow(/same host\/port\/database as DATABASE_URL/);
  });

  it("allows TEST_DATABASE_URL and DATABASE_URL to point at different databases on the same host", () => {
    process.env.DATABASE_URL = "postgresql://app:secret@db.internal:5432/pharmacy_duty_scheduler";
    process.env.TEST_DATABASE_URL = "postgresql://app:secret@db.internal:5432/pharmacy_duty_scheduler_test";
    expect(resolveTestDatabaseUrl()).toBe(process.env.TEST_DATABASE_URL);
  });

  it("throws when the database name has no recognized test marker", () => {
    process.env.TEST_DATABASE_URL = "postgresql://user:pass@localhost:5432/pharmacy_duty_scheduler";
    delete process.env.DATABASE_URL;
    expect(() => resolveTestDatabaseUrl()).toThrow(/does not contain "test"/);
  });

  it("accepts a database name containing \"testing\"", () => {
    process.env.TEST_DATABASE_URL = "postgresql://user:pass@localhost:5432/pharmacy_testing";
    delete process.env.DATABASE_URL;
    expect(resolveTestDatabaseUrl()).toBe(process.env.TEST_DATABASE_URL);
  });

  it("accepts a database name containing \"integration\"", () => {
    process.env.TEST_DATABASE_URL = "postgresql://user:pass@localhost:5432/pharmacy_integration";
    delete process.env.DATABASE_URL;
    expect(resolveTestDatabaseUrl()).toBe(process.env.TEST_DATABASE_URL);
  });

  it("rejects a database name containing a production marker even alongside a test marker", () => {
    process.env.TEST_DATABASE_URL = "postgresql://user:pass@localhost:5432/production_test";
    delete process.env.DATABASE_URL;
    expect(() => resolveTestDatabaseUrl()).toThrow(/looks like a production database/);
  });

  it("rejects a hostname containing a production marker even when the database name has a test marker", () => {
    process.env.TEST_DATABASE_URL = "postgresql://user:pass@prod-db.internal:5432/pharmacy_test";
    delete process.env.DATABASE_URL;
    expect(() => resolveTestDatabaseUrl()).toThrow(/looks like a production database/);
  });

  it("rejects a file:/SQLite URL", () => {
    process.env.TEST_DATABASE_URL = "file:./test.db";
    delete process.env.DATABASE_URL;
    expect(() => resolveTestDatabaseUrl()).toThrow(/must be a PostgreSQL connection string/);
  });

  it("rejects a malformed URL", () => {
    process.env.TEST_DATABASE_URL = "not a valid url at all";
    delete process.env.DATABASE_URL;
    expect(() => resolveTestDatabaseUrl()).toThrow(/failed to parse/);
  });

  it("accepts a well-formed PostgreSQL test URL", () => {
    process.env.TEST_DATABASE_URL = "postgresql://app:app@localhost:5432/pharmacy_duty_scheduler_test";
    delete process.env.DATABASE_URL;
    expect(resolveTestDatabaseUrl()).toBe(process.env.TEST_DATABASE_URL);
  });

  it("accepts the postgres:// scheme alias", () => {
    process.env.TEST_DATABASE_URL = "postgres://app:app@localhost:5432/pharmacy_duty_scheduler_test";
    delete process.env.DATABASE_URL;
    expect(resolveTestDatabaseUrl()).toBe(process.env.TEST_DATABASE_URL);
  });

  it("never includes the password or query-string secrets in any thrown error message", () => {
    const secretPassword = "sUp3rSecretPassw0rd!!!";
    const secretQueryValue = "leaked-query-secret-value";
    const scenarios: Array<() => void> = [
      () => {
        process.env.TEST_DATABASE_URL = `postgresql://user:${secretPassword}@localhost:5432/pharmacy_duty_scheduler?token=${secretQueryValue}`;
        process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
      },
      () => {
        process.env.TEST_DATABASE_URL = `postgresql://user:${secretPassword}@localhost:5432/pharmacy_prod?token=${secretQueryValue}`;
        delete process.env.DATABASE_URL;
      },
      () => {
        process.env.TEST_DATABASE_URL = `postgresql://user:${secretPassword}@prod-host:5432/pharmacy_test?token=${secretQueryValue}`;
        delete process.env.DATABASE_URL;
      },
    ];

    for (const setup of scenarios) {
      setup();
      let caught: unknown;
      try {
        resolveTestDatabaseUrl();
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(Error);
      const message = (caught as Error).message;
      expect(message).not.toContain(secretPassword);
      expect(message).not.toContain(secretQueryValue);
    }
  });
});

describe("resolveRestoreDatabaseUrl", () => {
  afterEach(() => {
    restoreEnv();
  });

  it("throws when RESTORE_DATABASE_URL is missing", () => {
    delete process.env.RESTORE_DATABASE_URL;
    process.env.DATABASE_URL = "postgresql://user:pass@prod-host:5432/pharmacy_duty_scheduler";
    expect(() => resolveRestoreDatabaseUrl()).toThrow(/RESTORE_DATABASE_URL is not set/);
  });

  it("throws when RESTORE_DATABASE_URL equals DATABASE_URL (byte-identical)", () => {
    const url = "postgresql://user:pass@localhost:5432/pharmacy_duty_scheduler";
    process.env.RESTORE_DATABASE_URL = url;
    process.env.DATABASE_URL = url;
    expect(() => resolveRestoreDatabaseUrl()).toThrow(
      /must not be the same value as DATABASE_URL/
    );
  });

  it("throws when RESTORE_DATABASE_URL resolves to the same host/port/db as DATABASE_URL despite different credentials", () => {
    process.env.DATABASE_URL = "postgresql://app:secret1@db.internal:5432/pharmacy_restore";
    process.env.RESTORE_DATABASE_URL =
      "postgresql://other:secret2@db.internal:5432/pharmacy_restore?sslmode=require";
    expect(() => resolveRestoreDatabaseUrl()).toThrow(/same host\/port\/database as DATABASE_URL/);
  });

  it("throws when the restore target has no test/restore/staging/recovery marker", () => {
    process.env.RESTORE_DATABASE_URL = "postgresql://user:pass@localhost:5432/pharmacy_duty_scheduler";
    delete process.env.DATABASE_URL;
    expect(() => resolveRestoreDatabaseUrl()).toThrow(/does not contain/);
  });

  it("throws when the restore target contains a prod/production/live marker", () => {
    process.env.RESTORE_DATABASE_URL = "postgresql://user:pass@localhost:5432/pharmacy_production_restore";
    delete process.env.DATABASE_URL;
    expect(() => resolveRestoreDatabaseUrl()).toThrow(/looks like a production database/);
  });

  it("throws when the restore target's hostname contains a production marker", () => {
    process.env.RESTORE_DATABASE_URL = "postgresql://user:pass@prod-db.internal:5432/pharmacy_restore";
    delete process.env.DATABASE_URL;
    expect(() => resolveRestoreDatabaseUrl()).toThrow(/looks like a production database/);
  });

  it.each(["restore", "staging", "recovery", "test", "testing", "integration"])(
    "accepts a database name containing the marker %j",
    (marker) => {
      process.env.RESTORE_DATABASE_URL = `postgresql://user:pass@localhost:5432/pharmacy_${marker}`;
      delete process.env.DATABASE_URL;
      expect(resolveRestoreDatabaseUrl()).toBe(process.env.RESTORE_DATABASE_URL);
    }
  );

  it("rejects a file:/SQLite restore target", () => {
    process.env.RESTORE_DATABASE_URL = "file:./restore.db";
    delete process.env.DATABASE_URL;
    expect(() => resolveRestoreDatabaseUrl()).toThrow(/must be a PostgreSQL connection string/);
  });

  it("rejects a malformed restore target URL", () => {
    process.env.RESTORE_DATABASE_URL = "not a valid url at all";
    delete process.env.DATABASE_URL;
    expect(() => resolveRestoreDatabaseUrl()).toThrow(/failed to parse/);
  });

  it("never includes the password or query-string secrets in any thrown error message", () => {
    const secretPassword = "sUp3rSecretPassw0rd!!!";
    const secretQueryValue = "leaked-query-secret-value";
    const scenarios: Array<() => void> = [
      () => {
        process.env.RESTORE_DATABASE_URL = `postgresql://user:${secretPassword}@localhost:5432/pharmacy_duty_scheduler?token=${secretQueryValue}`;
        process.env.DATABASE_URL = process.env.RESTORE_DATABASE_URL;
      },
      () => {
        process.env.RESTORE_DATABASE_URL = `postgresql://user:${secretPassword}@localhost:5432/pharmacy_prod_restore?token=${secretQueryValue}`;
        delete process.env.DATABASE_URL;
      },
      () => {
        process.env.RESTORE_DATABASE_URL = `postgresql://user:${secretPassword}@prod-host:5432/pharmacy_restore?token=${secretQueryValue}`;
        delete process.env.DATABASE_URL;
      },
    ];

    for (const setup of scenarios) {
      setup();
      let caught: unknown;
      try {
        resolveRestoreDatabaseUrl();
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(Error);
      const message = (caught as Error).message;
      expect(message).not.toContain(secretPassword);
      expect(message).not.toContain(secretQueryValue);
    }
  });
});

describe("sanitizedDatabaseIdentifier", () => {
  it("never includes credentials or query-string values", () => {
    const url = "postgresql://user:sUp3rSecret@db.internal:5432/pharmacy_test?sslmode=require&token=leak-me";
    const identifier = sanitizedDatabaseIdentifier(url);
    expect(identifier).toBe("db.internal:5432/pharmacy_test");
    expect(identifier).not.toContain("sUp3rSecret");
    expect(identifier).not.toContain("leak-me");
    expect(identifier).not.toContain("user");
  });

  it("falls back to the default PostgreSQL port when none is specified", () => {
    expect(sanitizedDatabaseIdentifier("postgresql://user:pass@db.internal/pharmacy_test")).toBe(
      "db.internal:5432/pharmacy_test"
    );
  });
});
