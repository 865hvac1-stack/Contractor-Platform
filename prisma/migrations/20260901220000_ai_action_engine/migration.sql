-- Additive Action Engine tables. Tenant-scoped. Non-destructive.

CREATE TYPE "AIActionLevel" AS ENUM ('READ', 'PREPARE', 'EXECUTE');
CREATE TYPE "AIActionRisk" AS ENUM ('LOW', 'MEDIUM', 'HIGH');
CREATE TYPE "AIActionRequestStatus" AS ENUM ('DRAFT', 'AWAITING_APPROVAL', 'APPROVED', 'EXECUTING', 'COMPLETED', 'PARTIALLY_COMPLETED', 'FAILED', 'CANCELED', 'EXPIRED');
CREATE TYPE "AIActionTargetStatus" AS ENUM ('PENDING', 'EXCLUDED', 'EXECUTED', 'SKIPPED', 'FAILED');

ALTER TABLE "AIConversation" ADD COLUMN "lastResultSet" JSONB;

CREATE TABLE "AIActionRequest" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "requestedByUserId" TEXT NOT NULL,
    "conversationId" TEXT,
    "approvedByUserId" TEXT,
    "actionKey" TEXT NOT NULL,
    "actionVersion" INTEGER NOT NULL DEFAULT 1,
    "level" "AIActionLevel" NOT NULL,
    "riskLevel" "AIActionRisk" NOT NULL,
    "status" "AIActionRequestStatus" NOT NULL DEFAULT 'DRAFT',
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "input" JSONB NOT NULL,
    "preview" JSONB NOT NULL,
    "criteria" JSONB,
    "estimatedImpactCents" INTEGER,
    "targetCount" INTEGER NOT NULL DEFAULT 0,
    "executedCount" INTEGER NOT NULL DEFAULT 0,
    "skippedCount" INTEGER NOT NULL DEFAULT 0,
    "failedCount" INTEGER NOT NULL DEFAULT 0,
    "provider" TEXT,
    "executionMode" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "failureReason" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "approvedAt" TIMESTAMP(3),
    "executedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AIActionRequest_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AIActionTarget" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "recordType" TEXT NOT NULL,
    "recordId" TEXT NOT NULL,
    "customerId" TEXT,
    "customerName" TEXT,
    "amountCents" INTEGER,
    "daysValue" INTEGER,
    "channel" TEXT,
    "recipient" TEXT,
    "draftMessage" TEXT,
    "reason" TEXT,
    "payload" JSONB,
    "status" "AIActionTargetStatus" NOT NULL DEFAULT 'PENDING',
    "skipReason" TEXT,
    "failureReason" TEXT,
    "provider" TEXT,
    "providerResultId" TEXT,
    "executedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AIActionTarget_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CompanyTask" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "assignedToUserId" TEXT,
    "createdByUserId" TEXT,
    "actionRequestId" TEXT,
    "title" TEXT NOT NULL,
    "details" TEXT,
    "dueAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "relatedType" TEXT,
    "relatedId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CompanyTask_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AIActionRequest_companyId_idempotencyKey_key" ON "AIActionRequest"("companyId", "idempotencyKey");
CREATE INDEX "AIActionRequest_companyId_status_createdAt_idx" ON "AIActionRequest"("companyId", "status", "createdAt");
CREATE INDEX "AIActionRequest_companyId_conversationId_idx" ON "AIActionRequest"("companyId", "conversationId");
CREATE INDEX "AIActionRequest_companyId_actionKey_idx" ON "AIActionRequest"("companyId", "actionKey");
CREATE INDEX "AIActionTarget_companyId_requestId_idx" ON "AIActionTarget"("companyId", "requestId");
CREATE INDEX "AIActionTarget_companyId_recordType_recordId_idx" ON "AIActionTarget"("companyId", "recordType", "recordId");
CREATE INDEX "AIActionTarget_companyId_status_idx" ON "AIActionTarget"("companyId", "status");
CREATE INDEX "CompanyTask_companyId_status_dueAt_idx" ON "CompanyTask"("companyId", "status", "dueAt");
CREATE INDEX "CompanyTask_companyId_assignedToUserId_idx" ON "CompanyTask"("companyId", "assignedToUserId");

ALTER TABLE "AIActionRequest" ADD CONSTRAINT "AIActionRequest_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AIActionRequest" ADD CONSTRAINT "AIActionRequest_requestedByUserId_fkey" FOREIGN KEY ("requestedByUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AIActionRequest" ADD CONSTRAINT "AIActionRequest_approvedByUserId_fkey" FOREIGN KEY ("approvedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AIActionRequest" ADD CONSTRAINT "AIActionRequest_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "AIConversation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AIActionTarget" ADD CONSTRAINT "AIActionTarget_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "AIActionRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AIActionTarget" ADD CONSTRAINT "AIActionTarget_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CompanyTask" ADD CONSTRAINT "CompanyTask_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CompanyTask" ADD CONSTRAINT "CompanyTask_assignedToUserId_fkey" FOREIGN KEY ("assignedToUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CompanyTask" ADD CONSTRAINT "CompanyTask_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
