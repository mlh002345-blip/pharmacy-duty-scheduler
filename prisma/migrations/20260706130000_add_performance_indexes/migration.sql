-- CreateIndex
CREATE INDEX "Pharmacy_isActive_idx" ON "Pharmacy"("isActive");

-- CreateIndex
CREATE INDEX "DutySchedule_regionId_idx" ON "DutySchedule"("regionId");

-- CreateIndex
CREATE INDEX "DutySchedule_status_idx" ON "DutySchedule"("status");

-- CreateIndex
CREATE INDEX "DutyAssignment_date_idx" ON "DutyAssignment"("date");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

