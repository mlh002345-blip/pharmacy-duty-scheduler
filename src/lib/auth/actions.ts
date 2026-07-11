"use server";

import { redirect } from "next/navigation";

import { prisma } from "@/lib/prisma";
import { type ActionState, zodErrorState } from "@/lib/action-state";
import { loginSchema } from "@/lib/validations/auth";
import { logger } from "@/lib/observability/logger";
import { getRequestId } from "@/lib/observability/request-id";
import { getClientIdentity } from "@/lib/security/client-identity";
import {
  checkLoginRateLimit,
  clearAccountLoginRateLimit,
  hashAccountIdentifier,
  recordLoginFailure,
  type RateLimitCheckResult,
} from "./login-rate-limit";
import { verifyPassword } from "./password";
import { createSession, destroySession } from "./session";

const GENERIC_FAILURE_MESSAGE = "Hatalı e-posta veya şifre.";
const RATE_LIMIT_MESSAGE =
  "Çok fazla başarısız giriş denemesi yapıldı. Lütfen bir süre sonra tekrar deneyin.";

// Reason categories are for server-side operational logs only (e.g. spotting
// a credential-stuffing pattern) — never surfaced to the client, which
// always sees the same generic message regardless of reason, unchanged
// from before this logging was added.
async function logLoginFailure(reason: "unknown_account" | "invalid_password" | "inactive_account") {
  logger.warn("auth_login_failed", {
    requestId: await getRequestId(),
    reason,
  });
}

async function logRateLimited(result: Extract<RateLimitCheckResult, { blocked: true }>) {
  // Deliberately does not include the account/network bucket key itself
  // (already a one-way hash, but there is no reason to echo it into logs
  // either) — only which dimension triggered the block and how long the
  // cooldown is, which is enough to spot a pattern without adding any
  // per-identifier tracking to the log stream itself.
  logger.warn("auth_login_rate_limited", {
    requestId: await getRequestId(),
    dimension: result.dimension,
    retryAfterSeconds: result.retryAfterSeconds,
  });
}

export async function loginAction(
  _prevState: ActionState,
  formData: FormData
): Promise<ActionState> {
  const parsed = loginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) {
    // A validation failure (missing/malformed field) never constitutes a
    // real credential attempt — it is never checked against, or recorded
    // by, the rate limiter.
    return zodErrorState(parsed.error, "Lütfen formdaki hataları düzeltin.");
  }

  const identity = await getClientIdentity();
  const accountBucketKey = hashAccountIdentifier(parsed.data.email);
  const rateLimitKeys = { networkBucketKey: identity.networkBucketKey, accountBucketKey };

  const preCheck = await checkLoginRateLimit(rateLimitKeys);
  if (preCheck.blocked) {
    await logRateLimited(preCheck);
    return { success: false, message: RATE_LIMIT_MESSAGE };
  }

  const user = await prisma.user.findUnique({
    where: { email: parsed.data.email },
  });
  if (!user) {
    const afterFailure = await recordLoginFailure(rateLimitKeys);
    await logLoginFailure("unknown_account");
    if (afterFailure.blocked) await logRateLimited(afterFailure);
    return { success: false, message: GENERIC_FAILURE_MESSAGE };
  }

  const validPassword = await verifyPassword(parsed.data.password, user.passwordHash);
  if (!validPassword) {
    const afterFailure = await recordLoginFailure(rateLimitKeys);
    await logLoginFailure("invalid_password");
    if (afterFailure.blocked) await logRateLimited(afterFailure);
    return { success: false, message: GENERIC_FAILURE_MESSAGE };
  }

  if (!user.isActive) {
    // Kasıtlı olarak diğer giriş hatalarıyla aynı genel mesaj kullanılır;
    // aksi halde bir e-postanın var olup olmadığı veya pasif bir hesaba ait
    // olduğu, kimlik doğrulaması yapılmadan dışarıdan anlaşılabilir. Sunucu
    // taraflı log kaydı bu genel mesajı etkilemez, yalnızca operasyonel
    // teşhis içindir. Oran sınırlayıcı da diğer başarısız denemelerle aynı
    // şekilde davranır — pasif hesap, doğru şifreyle bile bir "başarısız
    // deneme" olarak sayılır.
    const afterFailure = await recordLoginFailure(rateLimitKeys);
    await logLoginFailure("inactive_account");
    if (afterFailure.blocked) await logRateLimited(afterFailure);
    return { success: false, message: GENERIC_FAILURE_MESSAGE };
  }

  await clearAccountLoginRateLimit(accountBucketKey);
  await createSession(user.id);
  // Logged only after the session is actually created — a DB outage
  // between credential verification and session creation (see Step 6's
  // chaos test, docs/security/24-db-resilience-connection-pool-validation.md)
  // would otherwise log "succeeded" for a login that never actually
  // established a session.
  logger.info("auth_login_succeeded", { requestId: await getRequestId(), userId: user.id });
  redirect("/");
}

export async function logoutAction() {
  await destroySession();
  redirect("/giris");
}
