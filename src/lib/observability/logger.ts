// Minimal, dependency-free structured server logger. Emits one-line JSON
// records via console.error/warn/info so Railway's platform-level stdout/
// stderr capture picks them up — no external logging/APM service.
//
// This is deliberately NOT a replacement for AuditLog
// (src/lib/audit.ts): AuditLog records successful, committed business
// mutations (who changed what row, with a before/after snapshot) and is
// written inside the same DB transaction as the change. This logger
// records operational events — failures, denials, authentication
// attempts, unexpected errors — that by definition often have no
// committed row to attach an AuditLog entry to. See
// docs/security/16-logging-observability-auditability.md for the full
// design rationale and the separation between the two.

export type LogLevel = "error" | "warn" | "info";

// Only plain scalar context is ever accepted — never nest raw objects
// (like a full Prisma error or a form-data object) into a log call.
export type LogContext = Record<string, string | number | boolean | undefined | null>;

// Any context key matching this pattern is redacted before the record is
// serialized, regardless of what value was passed for it. Case-insensitive
// and matches substrings, so e.g. "userToken" or "DATABASE_URL" are both
// caught.
const REDACTED_KEY_PATTERN =
  /password|token|cookie|authorization|secret|database.?url/i;

function redactContext(context: LogContext | undefined): Record<string, unknown> {
  if (!context) return {};
  const safe: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(context)) {
    if (value === undefined) continue;
    safe[key] = REDACTED_KEY_PATTERN.test(key) ? "[REDACTED]" : value;
  }
  return safe;
}

export type SafeError = {
  name?: string;
  code?: string;
  message?: string;
};

// Conservative, allow-list serialization of an unknown thrown value.
// Deliberately does NOT serialize the full error object, a stack trace,
// or Prisma query parameters (Prisma's own error `meta` field can embed
// the offending row's values, so it is never read here) — only the
// error's name, a known error code if present (e.g. Prisma's "P2002"),
// and a short, truncated message.
const MAX_MESSAGE_LENGTH = 200;

export function toSafeError(error: unknown): SafeError {
  if (!error || typeof error !== "object") {
    return typeof error === "string" ? { message: error.slice(0, MAX_MESSAGE_LENGTH) } : {};
  }
  const candidate = error as { name?: unknown; code?: unknown; message?: unknown };
  const safe: SafeError = {};
  if (typeof candidate.name === "string") safe.name = candidate.name;
  if (typeof candidate.code === "string") safe.code = candidate.code;
  if (typeof candidate.message === "string") {
    safe.message = candidate.message.slice(0, MAX_MESSAGE_LENGTH);
  }
  return safe;
}

function emit(level: LogLevel, event: string, context?: LogContext, error?: unknown): void {
  // A logging failure (e.g. a context value that can't be serialized)
  // must never break the business operation that triggered the log call.
  try {
    const record: Record<string, unknown> = {
      timestamp: new Date().toISOString(),
      level,
      event,
      ...redactContext(context),
    };
    if (error !== undefined) {
      record.error = toSafeError(error);
    }
    const line = JSON.stringify(record);
    if (level === "error") {
      console.error(line);
    } else if (level === "warn") {
      console.warn(line);
    } else {
      console.info(line);
    }
  } catch {
    // Swallowed intentionally — see comment above.
  }
}

export const logger = {
  error(event: string, context?: LogContext, error?: unknown): void {
    emit("error", event, context, error);
  },
  warn(event: string, context?: LogContext, error?: unknown): void {
    emit("warn", event, context, error);
  },
  info(event: string, context?: LogContext): void {
    emit("info", event, context);
  },
};
