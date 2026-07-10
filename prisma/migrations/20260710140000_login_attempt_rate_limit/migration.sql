-- Login Rate Limiting & Trusted Proxy/IP Validation (pre-pilot test plan,
-- Step 2): adds a minimal, transaction-safe counter table backing login
-- attempt rate limiting. See
-- docs/security/21-login-rate-limit-proxy-validation.md.
--
-- No raw email or IP address is ever stored — "bucketKey" is always a
-- SHA-256 digest of a normalized identifier (see
-- src/lib/security/hash-identifier.ts,
-- src/lib/security/client-identity.ts, src/lib/auth/login-rate-limit.ts).
-- "bucketType" distinguishes the two rate-limit dimensions ("NETWORK" /
-- "ACCOUNT").
--
-- Retention: this table is new and starts empty; there is no backfill.
-- Rows are small and bounded by the number of distinct (bucketType,
-- bucketKey) pairs actually attempted — same unbounded-but-slow growth
-- shape as the existing Session table (documented, not actively purged
-- in this pass; see the "Remaining limitations" section of the
-- accompanying doc).

-- CreateTable
CREATE TABLE "LoginAttempt" (
    "id" TEXT NOT NULL,
    "bucketType" TEXT NOT NULL,
    "bucketKey" TEXT NOT NULL,
    "failureCount" INTEGER NOT NULL DEFAULT 0,
    "windowStart" TIMESTAMP(3) NOT NULL,
    "blockedUntil" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LoginAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "LoginAttempt_bucketType_bucketKey_key" ON "LoginAttempt"("bucketType", "bucketKey");

-- CreateIndex
CREATE INDEX "LoginAttempt_blockedUntil_idx" ON "LoginAttempt"("blockedUntil");

-- CreateIndex
CREATE INDEX "LoginAttempt_windowStart_idx" ON "LoginAttempt"("windowStart");
