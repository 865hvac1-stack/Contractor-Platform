-- CreateEnum
CREATE TYPE "ReceiptAssignment" AS ENUM ('UNASSIGNED', 'JOB', 'VEHICLE', 'OVERHEAD', 'INVENTORY');

-- CreateEnum
CREATE TYPE "ReceiptDuplicateStatus" AS ENUM ('NONE', 'POSSIBLE');

-- CreateEnum
CREATE TYPE "JobCostCategory" AS ENUM ('EQUIPMENT', 'MATERIALS', 'LABOR', 'SUBCONTRACTOR', 'PERMIT', 'FUEL', 'RENTAL', 'INVENTORY', 'OTHER');

-- CreateEnum
CREATE TYPE "JobCostSource" AS ENUM ('RECEIPT', 'EXPENSE', 'MANUAL', 'LABOR', 'INVENTORY', 'IMPORTED');

-- CreateEnum
CREATE TYPE "QuickBooksInvoiceTrigger" AS ENUM ('MANUAL_ONLY', 'WHEN_CREATED', 'WHEN_SENT', 'WHEN_JOB_COMPLETED', 'WHEN_PAYMENT_RECEIVED');

-- CreateEnum
CREATE TYPE "QuickBooksSyncStatus" AS ENUM ('PENDING', 'SYNCING', 'SYNCED', 'FAILED', 'REAUTH_REQUIRED', 'NEEDS_REVIEW');

-- AlterTable
ALTER TABLE "User" ADD COLUMN "loadedLaborCostCents" INTEGER;

-- AlterTable
ALTER TABLE "Receipt" ADD COLUMN "uploadedById" TEXT,
ADD COLUMN "fileHash" TEXT,
ADD COLUMN "assignment" "ReceiptAssignment" NOT NULL DEFAULT 'UNASSIGNED',
ADD COLUMN "duplicateStatus" "ReceiptDuplicateStatus" NOT NULL DEFAULT 'NONE',
ADD COLUMN "duplicateOfId" TEXT,
ADD COLUMN "vendor" TEXT,
ADD COLUMN "receiptDate" TIMESTAMP(3),
ADD COLUMN "subtotalCents" INTEGER,
ADD COLUMN "tipCents" INTEGER,
ADD COLUMN "totalCents" INTEGER,
ADD COLUMN "category" "ExpenseCategory",
ADD COLUMN "description" TEXT,
ADD COLUMN "paymentMethod" "PaymentMethod",
ADD COLUMN "lastFour" TEXT,
ADD COLUMN "notes" TEXT,
ADD COLUMN "confidence" INTEGER,
ADD COLUMN "jobId" TEXT,
ADD COLUMN "vehicleId" TEXT,
ADD COLUMN "confirmedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "Vehicle" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "unitNumber" TEXT,
    "year" INTEGER,
    "make" TEXT,
    "model" TEXT,
    "vin" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Vehicle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobCost" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "category" "JobCostCategory" NOT NULL,
    "description" TEXT,
    "amountCents" INTEGER NOT NULL,
    "sourceType" "JobCostSource" NOT NULL,
    "sourceId" TEXT,
    "receiptId" TEXT,
    "expenseId" TEXT,
    "createdById" TEXT NOT NULL,
    "confirmed" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JobCost_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuickBooksSettings" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "invoiceSyncTrigger" "QuickBooksInvoiceTrigger" NOT NULL DEFAULT 'MANUAL_ONLY',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QuickBooksSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuickBooksMapping" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "internalId" TEXT NOT NULL,
    "quickbooksId" TEXT NOT NULL,
    "lastSyncedAt" TIMESTAMP(3),
    "status" "QuickBooksSyncStatus" NOT NULL DEFAULT 'SYNCED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QuickBooksMapping_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuickBooksSyncEvent" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "internalId" TEXT,
    "quickbooksId" TEXT,
    "direction" TEXT NOT NULL DEFAULT 'PUSH',
    "status" "QuickBooksSyncStatus" NOT NULL,
    "action" TEXT NOT NULL,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QuickBooksSyncEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Vehicle_companyId_idx" ON "Vehicle"("companyId");
CREATE INDEX "Vehicle_companyId_active_idx" ON "Vehicle"("companyId", "active");
CREATE UNIQUE INDEX "JobCost_companyId_expenseId_key" ON "JobCost"("companyId", "expenseId");
CREATE INDEX "JobCost_companyId_jobId_idx" ON "JobCost"("companyId", "jobId");
CREATE INDEX "JobCost_companyId_confirmed_idx" ON "JobCost"("companyId", "confirmed");
CREATE UNIQUE INDEX "QuickBooksSettings_companyId_key" ON "QuickBooksSettings"("companyId");
CREATE UNIQUE INDEX "QuickBooksMapping_companyId_entityType_internalId_key" ON "QuickBooksMapping"("companyId", "entityType", "internalId");
CREATE INDEX "QuickBooksMapping_companyId_entityType_quickbooksId_idx" ON "QuickBooksMapping"("companyId", "entityType", "quickbooksId");
CREATE INDEX "QuickBooksSyncEvent_companyId_createdAt_idx" ON "QuickBooksSyncEvent"("companyId", "createdAt");
CREATE INDEX "QuickBooksSyncEvent_companyId_entityType_internalId_idx" ON "QuickBooksSyncEvent"("companyId", "entityType", "internalId");
CREATE INDEX "Receipt_companyId_assignment_idx" ON "Receipt"("companyId", "assignment");
CREATE INDEX "Receipt_companyId_fileHash_idx" ON "Receipt"("companyId", "fileHash");
CREATE INDEX "Receipt_companyId_jobId_idx" ON "Receipt"("companyId", "jobId");
CREATE INDEX "Receipt_companyId_vehicleId_idx" ON "Receipt"("companyId", "vehicleId");

-- AddForeignKey
ALTER TABLE "Receipt" ADD CONSTRAINT "Receipt_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Receipt" ADD CONSTRAINT "Receipt_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Receipt" ADD CONSTRAINT "Receipt_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Receipt" ADD CONSTRAINT "Receipt_duplicateOfId_fkey" FOREIGN KEY ("duplicateOfId") REFERENCES "Receipt"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Vehicle" ADD CONSTRAINT "Vehicle_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "JobCost" ADD CONSTRAINT "JobCost_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "JobCost" ADD CONSTRAINT "JobCost_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "JobCost" ADD CONSTRAINT "JobCost_receiptId_fkey" FOREIGN KEY ("receiptId") REFERENCES "Receipt"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "JobCost" ADD CONSTRAINT "JobCost_expenseId_fkey" FOREIGN KEY ("expenseId") REFERENCES "Expense"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "JobCost" ADD CONSTRAINT "JobCost_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "QuickBooksSettings" ADD CONSTRAINT "QuickBooksSettings_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "QuickBooksMapping" ADD CONSTRAINT "QuickBooksMapping_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "QuickBooksSyncEvent" ADD CONSTRAINT "QuickBooksSyncEvent_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
