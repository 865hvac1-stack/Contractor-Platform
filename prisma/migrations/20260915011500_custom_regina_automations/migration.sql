ALTER TABLE "Automation"
  ADD COLUMN "createdById" TEXT,
  ADD COLUMN "sourceType" TEXT NOT NULL DEFAULT 'RECOMMENDED',
  ADD COLUMN "sourceRequest" TEXT,
  ADD COLUMN "interpretation" JSONB,
  ADD COLUMN "audience" TEXT NOT NULL DEFAULT 'EVENT_CUSTOMER',
  ADD COLUMN "delayMinutes" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "isCompanyTemplate" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "followUpDelayMinutes" INTEGER,
  ADD COLUMN "maxAttempts" INTEGER NOT NULL DEFAULT 1;

ALTER TABLE "AutomationExecution"
  ADD COLUMN "configSnapshot" JSONB,
  ADD COLUMN "scheduledFor" TIMESTAMP(3),
  ADD COLUMN "attemptCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "nextFollowUpAt" TIMESTAMP(3);

CREATE INDEX "AutomationExecution_status_scheduledFor_idx"
  ON "AutomationExecution"("status", "scheduledFor");

CREATE INDEX "AutomationExecution_status_nextFollowUpAt_idx"
  ON "AutomationExecution"("status", "nextFollowUpAt");
