-- Extend the existing customer, automation, communication, and technician records.
ALTER TABLE "Membership"
  ADD COLUMN "customerPhotoPath" TEXT,
  ADD COLUMN "customerDisplayName" TEXT,
  ADD COLUMN "customerBio" TEXT,
  ADD COLUMN "yearsExperience" INTEGER,
  ADD COLUMN "certifications" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "customerIntroduction" TEXT;

ALTER TABLE "Customer"
  ADD COLUMN "smsMarketingOptedOutAt" TIMESTAMP(3),
  ADD COLUMN "smsOptOutSource" TEXT,
  ADD COLUMN "communicationConsentUpdatedAt" TIMESTAMP(3);

ALTER TABLE "CommunicationThread"
  ADD COLUMN "handlingState" TEXT NOT NULL DEFAULT 'UNASSIGNED',
  ADD COLUMN "handledByUserId" TEXT,
  ADD COLUMN "currentGoal" TEXT,
  ADD COLUMN "needsHumanAt" TIMESTAMP(3),
  ADD COLUMN "reginaPausedAt" TIMESTAMP(3);

ALTER TABLE "Automation"
  ADD COLUMN "promotionId" TEXT,
  ADD COLUMN "templateKey" TEXT,
  ADD COLUMN "mode" TEXT NOT NULL DEFAULT 'SEND_MESSAGE',
  ADD COLUMN "goal" TEXT,
  ADD COLUMN "channel" TEXT NOT NULL DEFAULT 'SMS',
  ADD COLUMN "firstMessage" TEXT,
  ADD COLUMN "allowedActions" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "escalationRules" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "stopConditions" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "quietHoursStart" INTEGER,
  ADD COLUMN "quietHoursEnd" INTEGER,
  ADD COLUMN "lastTriggeredAt" TIMESTAMP(3);

-- Promotions are tenant-scoped and validated again when an automation executes.
CREATE TABLE "Promotion" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "internalDescription" TEXT,
  "headline" TEXT NOT NULL,
  "customerCopy" TEXT,
  "offer" TEXT NOT NULL,
  "startsAt" TIMESTAMP(3) NOT NULL,
  "endsAt" TIMESTAMP(3) NOT NULL,
  "eligibleServices" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "audience" TEXT NOT NULL DEFAULT 'ALL_CUSTOMERS',
  "targeting" JSONB,
  "promoCode" TEXT,
  "imagePath" TEXT,
  "terms" TEXT,
  "bookingLinkBehavior" TEXT NOT NULL DEFAULT 'REGINA_BOOKS',
  "status" TEXT NOT NULL DEFAULT 'DRAFT',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Promotion_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DomainEvent" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "sourceType" TEXT NOT NULL,
  "sourceId" TEXT NOT NULL,
  "customerId" TEXT,
  "jobId" TEXT,
  "payload" JSONB,
  "idempotencyKey" TEXT NOT NULL,
  "occurredAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DomainEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AutomationExecution" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "automationId" TEXT NOT NULL,
  "eventId" TEXT NOT NULL,
  "customerId" TEXT,
  "threadId" TEXT,
  "promotionId" TEXT,
  "sourceType" TEXT NOT NULL,
  "sourceId" TEXT NOT NULL,
  "goal" TEXT,
  "mode" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'STARTED',
  "decision" TEXT,
  "firstMessage" TEXT,
  "messageId" TEXT,
  "failure" TEXT,
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "repliedAt" TIMESTAMP(3),
  "goalCompletedAt" TIMESTAMP(3),
  "humanTakeoverAt" TIMESTAMP(3),
  "optedOutAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AutomationExecution_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ConversationGoalSession" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "threadId" TEXT NOT NULL,
  "executionId" TEXT,
  "customerId" TEXT,
  "propertyId" TEXT,
  "jobId" TEXT,
  "goal" TEXT NOT NULL,
  "state" TEXT NOT NULL DEFAULT 'STARTED',
  "context" JSONB,
  "allowedActions" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "stopConditions" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "lastInboundMessageId" TEXT,
  "lastOutboundMessageId" TEXT,
  "humanTakeoverById" TEXT,
  "completedAt" TIMESTAMP(3),
  "expiresAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ConversationGoalSession_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ConversationAuditEvent" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "threadId" TEXT,
  "executionId" TEXT,
  "event" TEXT NOT NULL,
  "decision" TEXT,
  "details" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ConversationAuditEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CustomerRequest" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "customerId" TEXT NOT NULL,
  "jobId" TEXT NOT NULL,
  "threadId" TEXT,
  "body" TEXT NOT NULL,
  "source" TEXT NOT NULL DEFAULT 'CUSTOMER_CONVERSATION',
  "author" TEXT NOT NULL DEFAULT 'REGINA',
  "acknowledgedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CustomerRequest_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Automation_companyId_templateKey_key" ON "Automation"("companyId", "templateKey");
CREATE INDEX "Automation_companyId_enabled_trigger_idx" ON "Automation"("companyId", "enabled", "trigger");
CREATE INDEX "Automation_companyId_promotionId_idx" ON "Automation"("companyId", "promotionId");
CREATE INDEX "CommunicationThread_companyId_handlingState_lastActivityAt_idx" ON "CommunicationThread"("companyId", "handlingState", "lastActivityAt");
CREATE INDEX "Promotion_companyId_status_startsAt_endsAt_idx" ON "Promotion"("companyId", "status", "startsAt", "endsAt");
CREATE UNIQUE INDEX "DomainEvent_companyId_idempotencyKey_key" ON "DomainEvent"("companyId", "idempotencyKey");
CREATE INDEX "DomainEvent_companyId_type_occurredAt_idx" ON "DomainEvent"("companyId", "type", "occurredAt");
CREATE INDEX "DomainEvent_companyId_customerId_occurredAt_idx" ON "DomainEvent"("companyId", "customerId", "occurredAt");
CREATE UNIQUE INDEX "AutomationExecution_companyId_automationId_eventId_key" ON "AutomationExecution"("companyId", "automationId", "eventId");
CREATE INDEX "AutomationExecution_companyId_status_startedAt_idx" ON "AutomationExecution"("companyId", "status", "startedAt");
CREATE INDEX "AutomationExecution_companyId_customerId_startedAt_idx" ON "AutomationExecution"("companyId", "customerId", "startedAt");
CREATE INDEX "AutomationExecution_companyId_threadId_status_idx" ON "AutomationExecution"("companyId", "threadId", "status");
CREATE UNIQUE INDEX "ConversationGoalSession_executionId_key" ON "ConversationGoalSession"("executionId");
CREATE INDEX "ConversationGoalSession_companyId_threadId_state_idx" ON "ConversationGoalSession"("companyId", "threadId", "state");
CREATE INDEX "ConversationGoalSession_companyId_customerId_updatedAt_idx" ON "ConversationGoalSession"("companyId", "customerId", "updatedAt");
CREATE INDEX "ConversationAuditEvent_companyId_createdAt_idx" ON "ConversationAuditEvent"("companyId", "createdAt");
CREATE INDEX "ConversationAuditEvent_companyId_threadId_createdAt_idx" ON "ConversationAuditEvent"("companyId", "threadId", "createdAt");
CREATE INDEX "ConversationAuditEvent_companyId_executionId_createdAt_idx" ON "ConversationAuditEvent"("companyId", "executionId", "createdAt");
CREATE INDEX "CustomerRequest_companyId_jobId_acknowledgedAt_createdAt_idx" ON "CustomerRequest"("companyId", "jobId", "acknowledgedAt", "createdAt");
CREATE INDEX "CustomerRequest_companyId_customerId_createdAt_idx" ON "CustomerRequest"("companyId", "customerId", "createdAt");

ALTER TABLE "Automation" ADD CONSTRAINT "Automation_promotionId_fkey" FOREIGN KEY ("promotionId") REFERENCES "Promotion"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Promotion" ADD CONSTRAINT "Promotion_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DomainEvent" ADD CONSTRAINT "DomainEvent_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AutomationExecution" ADD CONSTRAINT "AutomationExecution_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AutomationExecution" ADD CONSTRAINT "AutomationExecution_automationId_fkey" FOREIGN KEY ("automationId") REFERENCES "Automation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AutomationExecution" ADD CONSTRAINT "AutomationExecution_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "DomainEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AutomationExecution" ADD CONSTRAINT "AutomationExecution_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AutomationExecution" ADD CONSTRAINT "AutomationExecution_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "CommunicationThread"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AutomationExecution" ADD CONSTRAINT "AutomationExecution_promotionId_fkey" FOREIGN KEY ("promotionId") REFERENCES "Promotion"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ConversationGoalSession" ADD CONSTRAINT "ConversationGoalSession_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ConversationGoalSession" ADD CONSTRAINT "ConversationGoalSession_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "CommunicationThread"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ConversationGoalSession" ADD CONSTRAINT "ConversationGoalSession_executionId_fkey" FOREIGN KEY ("executionId") REFERENCES "AutomationExecution"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ConversationGoalSession" ADD CONSTRAINT "ConversationGoalSession_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ConversationAuditEvent" ADD CONSTRAINT "ConversationAuditEvent_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ConversationAuditEvent" ADD CONSTRAINT "ConversationAuditEvent_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "CommunicationThread"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ConversationAuditEvent" ADD CONSTRAINT "ConversationAuditEvent_executionId_fkey" FOREIGN KEY ("executionId") REFERENCES "AutomationExecution"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CustomerRequest" ADD CONSTRAINT "CustomerRequest_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CustomerRequest" ADD CONSTRAINT "CustomerRequest_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CustomerRequest" ADD CONSTRAINT "CustomerRequest_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CustomerRequest" ADD CONSTRAINT "CustomerRequest_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "CommunicationThread"("id") ON DELETE SET NULL ON UPDATE CASCADE;
