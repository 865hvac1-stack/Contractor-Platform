-- CreateEnum
CREATE TYPE "WaitingRecordState" AS ENUM ('ACTIVE', 'RESOLVED');

-- CreateEnum
CREATE TYPE "WaitingCadence" AS ENUM ('DAILY', 'EVERY_2_DAYS', 'EVERY_3_DAYS', 'WEEKLY', 'CUSTOM', 'MANUAL');

-- CreateTable
CREATE TABLE "WaitingColumn" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "archivedAt" TIMESTAMP(3),
    "warningDays" INTEGER NOT NULL DEFAULT 5,
    "urgentDays" INTEGER NOT NULL DEFAULT 10,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WaitingColumn_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WaitingBoardSetting" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "automaticUpdatesEnabled" BOOLEAN NOT NULL DEFAULT true,
    "defaultCadence" "WaitingCadence" NOT NULL DEFAULT 'EVERY_3_DAYS',
    "defaultCustomCadenceDays" INTEGER,
    "businessHoursStart" INTEGER NOT NULL DEFAULT 10,
    "overdueAlertUserIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WaitingBoardSetting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WaitingRecord" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "propertyId" TEXT,
    "columnId" TEXT NOT NULL,
    "state" "WaitingRecordState" NOT NULL DEFAULT 'ACTIVE',
    "reason" TEXT NOT NULL,
    "notes" TEXT,
    "priority" "JobPriority" NOT NULL DEFAULT 'NORMAL',
    "metadata" JSONB,
    "assignedOwnerUserId" TEXT,
    "enteredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastCustomerUpdateAt" TIMESTAMP(3),
    "nextCustomerUpdateAt" TIMESTAMP(3),
    "expectedResolutionAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "actualArrivalAt" TIMESTAMP(3),
    "customerRepliedAt" TIMESTAMP(3),
    "communicationEnabled" BOOLEAN NOT NULL DEFAULT true,
    "automationEnabled" BOOLEAN NOT NULL DEFAULT true,
    "cadence" "WaitingCadence" NOT NULL DEFAULT 'EVERY_3_DAYS',
    "customCadenceDays" INTEGER,
    "lastCommunicationStatus" TEXT,
    "lastCommunicationError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WaitingRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WaitingTransition" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "recordId" TEXT NOT NULL,
    "fromColumnId" TEXT,
    "toColumnId" TEXT NOT NULL,
    "actorId" TEXT,
    "actions" JSONB,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WaitingTransition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WaitingTemplate" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "columnId" TEXT,
    "kind" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WaitingTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WaitingCommunication" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "recordId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "templateKind" TEXT,
    "provider" TEXT,
    "providerMessageId" TEXT,
    "attemptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "failureReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WaitingCommunication_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WaitingColumn_companyId_key_key" ON "WaitingColumn"("companyId", "key");
CREATE INDEX "WaitingColumn_companyId_sortOrder_idx" ON "WaitingColumn"("companyId", "sortOrder");
CREATE UNIQUE INDEX "WaitingBoardSetting_companyId_key" ON "WaitingBoardSetting"("companyId");
CREATE INDEX "WaitingRecord_companyId_state_columnId_idx" ON "WaitingRecord"("companyId", "state", "columnId");
CREATE INDEX "WaitingRecord_companyId_nextCustomerUpdateAt_idx" ON "WaitingRecord"("companyId", "nextCustomerUpdateAt");
CREATE INDEX "WaitingRecord_companyId_jobId_idx" ON "WaitingRecord"("companyId", "jobId");
CREATE INDEX "WaitingRecord_companyId_customerId_idx" ON "WaitingRecord"("companyId", "customerId");
CREATE INDEX "WaitingRecord_companyId_assignedOwnerUserId_idx" ON "WaitingRecord"("companyId", "assignedOwnerUserId");
CREATE INDEX "WaitingTransition_companyId_recordId_idx" ON "WaitingTransition"("companyId", "recordId");
CREATE UNIQUE INDEX "WaitingTemplate_companyId_columnId_kind_key" ON "WaitingTemplate"("companyId", "columnId", "kind");
CREATE INDEX "WaitingTemplate_companyId_kind_idx" ON "WaitingTemplate"("companyId", "kind");
CREATE UNIQUE INDEX "WaitingCommunication_companyId_idempotencyKey_key" ON "WaitingCommunication"("companyId", "idempotencyKey");
CREATE INDEX "WaitingCommunication_companyId_recordId_createdAt_idx" ON "WaitingCommunication"("companyId", "recordId", "createdAt");

ALTER TABLE "WaitingColumn" ADD CONSTRAINT "WaitingColumn_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WaitingBoardSetting" ADD CONSTRAINT "WaitingBoardSetting_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WaitingRecord" ADD CONSTRAINT "WaitingRecord_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WaitingRecord" ADD CONSTRAINT "WaitingRecord_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WaitingRecord" ADD CONSTRAINT "WaitingRecord_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WaitingRecord" ADD CONSTRAINT "WaitingRecord_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "WaitingRecord" ADD CONSTRAINT "WaitingRecord_columnId_fkey" FOREIGN KEY ("columnId") REFERENCES "WaitingColumn"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WaitingRecord" ADD CONSTRAINT "WaitingRecord_assignedOwnerUserId_fkey" FOREIGN KEY ("assignedOwnerUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "WaitingTransition" ADD CONSTRAINT "WaitingTransition_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WaitingTransition" ADD CONSTRAINT "WaitingTransition_recordId_fkey" FOREIGN KEY ("recordId") REFERENCES "WaitingRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WaitingTransition" ADD CONSTRAINT "WaitingTransition_fromColumnId_fkey" FOREIGN KEY ("fromColumnId") REFERENCES "WaitingColumn"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "WaitingTransition" ADD CONSTRAINT "WaitingTransition_toColumnId_fkey" FOREIGN KEY ("toColumnId") REFERENCES "WaitingColumn"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WaitingTransition" ADD CONSTRAINT "WaitingTransition_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "WaitingTemplate" ADD CONSTRAINT "WaitingTemplate_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WaitingTemplate" ADD CONSTRAINT "WaitingTemplate_columnId_fkey" FOREIGN KEY ("columnId") REFERENCES "WaitingColumn"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WaitingCommunication" ADD CONSTRAINT "WaitingCommunication_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WaitingCommunication" ADD CONSTRAINT "WaitingCommunication_recordId_fkey" FOREIGN KEY ("recordId") REFERENCES "WaitingRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;
