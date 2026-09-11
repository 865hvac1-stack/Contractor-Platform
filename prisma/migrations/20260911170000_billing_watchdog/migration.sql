-- AlterTable
ALTER TABLE "Job" ADD COLUMN "checkedInAt" TIMESTAMP(3),
ADD COLUMN "checkedOutAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN "sentAt" TIMESTAMP(3),
ADD COLUMN "deliveryStatus" TEXT NOT NULL DEFAULT 'NONE',
ADD COLUMN "lastDeliveryError" TEXT,
ADD COLUMN "lastDeliveryChannel" TEXT;

-- CreateIndex
CREATE INDEX "Invoice_companyId_deliveryStatus_idx" ON "Invoice"("companyId", "deliveryStatus");

-- CreateEnum
CREATE TYPE "BillingWatchdogSeverity" AS ENUM ('CRITICAL', 'ACTION_NEEDED', 'WATCH');

-- CreateEnum
CREATE TYPE "BillingWatchdogFindingStatus" AS ENUM ('OPEN', 'RESOLVED', 'EXCLUDED');

-- CreateTable
CREATE TABLE "BillingWatchdogSettings" (
    "companyId" TEXT NOT NULL,
    "startDate" DATE NOT NULL,
    "checkoutGraceMinutes" INTEGER NOT NULL DEFAULT 120,
    "completedInvoiceGraceHours" INTEGER NOT NULL DEFAULT 8,
    "invoiceSendGraceHours" INTEGER NOT NULL DEFAULT 4,
    "accountingSyncGraceHours" INTEGER NOT NULL DEFAULT 24,
    "morningSummaryEnabled" BOOLEAN NOT NULL DEFAULT false,
    "morningSummaryRoles" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BillingWatchdogSettings_pkey" PRIMARY KEY ("companyId")
);

-- CreateTable
CREATE TABLE "BillingWatchdogFinding" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "severity" "BillingWatchdogSeverity" NOT NULL,
    "status" "BillingWatchdogFindingStatus" NOT NULL DEFAULT 'OPEN',
    "fingerprint" TEXT NOT NULL,
    "jobId" TEXT,
    "invoiceId" TEXT,
    "paymentId" TEXT,
    "customerId" TEXT,
    "technicianId" TEXT,
    "amountAtRiskCents" INTEGER,
    "amountUnknown" BOOLEAN NOT NULL DEFAULT false,
    "reason" TEXT NOT NULL,
    "recommendedAction" TEXT NOT NULL,
    "metadata" JSONB,
    "detectedAt" TIMESTAMP(3) NOT NULL,
    "firstDetectedAt" TIMESTAMP(3) NOT NULL,
    "lastDetectedAt" TIMESTAMP(3) NOT NULL,
    "resolvedAt" TIMESTAMP(3),
    "excludedAt" TIMESTAMP(3),
    "excludedById" TEXT,
    "exclusionCode" TEXT,
    "exclusionReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BillingWatchdogFinding_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BillingWatchdogFinding_companyId_fingerprint_key" ON "BillingWatchdogFinding"("companyId", "fingerprint");
CREATE INDEX "BillingWatchdogFinding_companyId_status_type_idx" ON "BillingWatchdogFinding"("companyId", "status", "type");
CREATE INDEX "BillingWatchdogFinding_companyId_lastDetectedAt_idx" ON "BillingWatchdogFinding"("companyId", "lastDetectedAt");
CREATE INDEX "BillingWatchdogFinding_companyId_jobId_idx" ON "BillingWatchdogFinding"("companyId", "jobId");
CREATE INDEX "BillingWatchdogFinding_companyId_invoiceId_idx" ON "BillingWatchdogFinding"("companyId", "invoiceId");

-- AddForeignKey
ALTER TABLE "BillingWatchdogSettings" ADD CONSTRAINT "BillingWatchdogSettings_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BillingWatchdogFinding" ADD CONSTRAINT "BillingWatchdogFinding_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BillingWatchdogFinding" ADD CONSTRAINT "BillingWatchdogFinding_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "BillingWatchdogFinding" ADD CONSTRAINT "BillingWatchdogFinding_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;
