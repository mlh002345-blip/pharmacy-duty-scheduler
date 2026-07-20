-- CreateTable
CREATE TABLE "SelfSignupAttempt" (
    "id" TEXT NOT NULL,
    "bucketKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SelfSignupAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SelfSignupAttempt_bucketKey_createdAt_idx" ON "SelfSignupAttempt"("bucketKey", "createdAt");

