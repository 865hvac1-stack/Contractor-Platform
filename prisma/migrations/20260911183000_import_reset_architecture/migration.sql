-- Safe import reset audit + unmatched-identity review queue.
-- Does not delete operational data.

CREATE TABLE "ImportResetOperation" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "initiatedById" TEXT NOT NULL,
    "sourceSystem" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "confirmationPhrase" TEXT,
    "counts" JSONB NOT NULL,
    "preserved" JSONB NOT NULL,
    "blocked" JSONB NOT NULL,
    "mixed" JSONB,
    "census" JSONB,
    "idempotentReplay" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "ImportResetOperation_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ImportResetOperation_companyId_createdAt_idx" ON "ImportResetOperation"("companyId", "createdAt");
CREATE INDEX "ImportResetOperation_companyId_sourceSystem_mode_idx" ON "ImportResetOperation"("companyId", "sourceSystem", "mode");

ALTER TABLE "ImportResetOperation" ADD CONSTRAINT "ImportResetOperation_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ImportResetOperation" ADD CONSTRAINT "ImportResetOperation_initiatedById_fkey" FOREIGN KEY ("initiatedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "ImportReviewItem" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "sourceSystem" TEXT NOT NULL,
    "recordType" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "confidence" TEXT NOT NULL,
    "proposedCustomerId" TEXT,
    "externalId" TEXT,
    "payload" JSONB NOT NULL,
    "reason" TEXT NOT NULL,
    "importSessionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ImportReviewItem_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ImportReviewItem_companyId_status_idx" ON "ImportReviewItem"("companyId", "status");
CREATE INDEX "ImportReviewItem_companyId_sourceSystem_recordType_idx" ON "ImportReviewItem"("companyId", "sourceSystem", "recordType");
CREATE INDEX "ImportReviewItem_companyId_proposedCustomerId_idx" ON "ImportReviewItem"("companyId", "proposedCustomerId");

ALTER TABLE "ImportReviewItem" ADD CONSTRAINT "ImportReviewItem_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
