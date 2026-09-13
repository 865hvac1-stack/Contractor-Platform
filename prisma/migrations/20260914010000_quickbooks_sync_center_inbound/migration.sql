-- CreateEnum
CREATE TYPE "AccountingClassification" AS ENUM ('INCOME', 'COGS', 'OPERATING_EXPENSE', 'ASSET', 'LIABILITY', 'EQUITY', 'OTHER');

-- AlterTable Customer
ALTER TABLE "Customer" ADD COLUMN IF NOT EXISTS "quickbooksCustomerId" TEXT;
ALTER TABLE "Customer" ADD COLUMN IF NOT EXISTS "quickbooksRealmId" TEXT;
ALTER TABLE "Customer" ADD COLUMN IF NOT EXISTS "quickbooksLastModifiedAt" TIMESTAMP(3);
ALTER TABLE "Customer" ADD COLUMN IF NOT EXISTS "lastSyncedAt" TIMESTAMP(3);
ALTER TABLE "Customer" ADD COLUMN IF NOT EXISTS "syncStatus" TEXT;
ALTER TABLE "Customer" ADD COLUMN IF NOT EXISTS "syncError" TEXT;

-- AlterTable Invoice
ALTER TABLE "Invoice" ADD COLUMN IF NOT EXISTS "quickbooksInvoiceId" TEXT;
ALTER TABLE "Invoice" ADD COLUMN IF NOT EXISTS "quickbooksRealmId" TEXT;
ALTER TABLE "Invoice" ADD COLUMN IF NOT EXISTS "quickbooksLastModifiedAt" TIMESTAMP(3);
ALTER TABLE "Invoice" ADD COLUMN IF NOT EXISTS "lastSyncedAt" TIMESTAMP(3);
ALTER TABLE "Invoice" ADD COLUMN IF NOT EXISTS "syncStatus" TEXT;
ALTER TABLE "Invoice" ADD COLUMN IF NOT EXISTS "syncError" TEXT;

-- AlterTable InvoiceLineItem
ALTER TABLE "InvoiceLineItem" ADD COLUMN IF NOT EXISTS "amountCents" INTEGER;
ALTER TABLE "InvoiceLineItem" ADD COLUMN IF NOT EXISTS "externalId" TEXT;
ALTER TABLE "InvoiceLineItem" ADD COLUMN IF NOT EXISTS "quickbooksItemId" TEXT;

-- AlterTable Payment
ALTER TABLE "Payment" ADD COLUMN IF NOT EXISTS "quickbooksPaymentId" TEXT;
ALTER TABLE "Payment" ADD COLUMN IF NOT EXISTS "quickbooksRealmId" TEXT;
ALTER TABLE "Payment" ADD COLUMN IF NOT EXISTS "quickbooksLastModifiedAt" TIMESTAMP(3);
ALTER TABLE "Payment" ADD COLUMN IF NOT EXISTS "lastSyncedAt" TIMESTAMP(3);
ALTER TABLE "Payment" ADD COLUMN IF NOT EXISTS "syncStatus" TEXT;
ALTER TABLE "Payment" ADD COLUMN IF NOT EXISTS "syncError" TEXT;

-- AlterTable Expense
ALTER TABLE "Expense" ADD COLUMN IF NOT EXISTS "vendorId" TEXT;
ALTER TABLE "Expense" ADD COLUMN IF NOT EXISTS "accountId" TEXT;
ALTER TABLE "Expense" ADD COLUMN IF NOT EXISTS "transactionType" TEXT;
ALTER TABLE "Expense" ADD COLUMN IF NOT EXISTS "quickbooksPurchaseId" TEXT;
ALTER TABLE "Expense" ADD COLUMN IF NOT EXISTS "quickbooksVendorId" TEXT;
ALTER TABLE "Expense" ADD COLUMN IF NOT EXISTS "quickbooksRealmId" TEXT;
ALTER TABLE "Expense" ADD COLUMN IF NOT EXISTS "quickbooksLastModifiedAt" TIMESTAMP(3);
ALTER TABLE "Expense" ADD COLUMN IF NOT EXISTS "lastSyncedAt" TIMESTAMP(3);
ALTER TABLE "Expense" ADD COLUMN IF NOT EXISTS "syncStatus" TEXT;
ALTER TABLE "Expense" ADD COLUMN IF NOT EXISTS "syncError" TEXT;

-- AlterTable QuickBooksSettings
ALTER TABLE "QuickBooksSettings" ADD COLUMN IF NOT EXISTS "lastSuccessfulInboundSyncAt" TIMESTAMP(3);
ALTER TABLE "QuickBooksSettings" ADD COLUMN IF NOT EXISTS "lastAttemptedInboundSyncAt" TIMESTAMP(3);
ALTER TABLE "QuickBooksSettings" ADD COLUMN IF NOT EXISTS "inboundSyncHealth" TEXT;
ALTER TABLE "QuickBooksSettings" ADD COLUMN IF NOT EXISTS "writeBackEnabled" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable PricebookItem
ALTER TABLE "PricebookItem" ADD COLUMN IF NOT EXISTS "sourceSystem" TEXT;
ALTER TABLE "PricebookItem" ADD COLUMN IF NOT EXISTS "externalId" TEXT;
ALTER TABLE "PricebookItem" ADD COLUMN IF NOT EXISTS "quickbooksItemId" TEXT;
ALTER TABLE "PricebookItem" ADD COLUMN IF NOT EXISTS "quickbooksRealmId" TEXT;
ALTER TABLE "PricebookItem" ADD COLUMN IF NOT EXISTS "incomeAccount" TEXT;
ALTER TABLE "PricebookItem" ADD COLUMN IF NOT EXISTS "cogsAccount" TEXT;
ALTER TABLE "PricebookItem" ADD COLUMN IF NOT EXISTS "taxCode" TEXT;
ALTER TABLE "PricebookItem" ADD COLUMN IF NOT EXISTS "lastSyncedAt" TIMESTAMP(3);
ALTER TABLE "PricebookItem" ADD COLUMN IF NOT EXISTS "syncStatus" TEXT;
ALTER TABLE "PricebookItem" ADD COLUMN IF NOT EXISTS "syncError" TEXT;

-- CreateTable Vendor
CREATE TABLE IF NOT EXISTS "Vendor" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "notes" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sourceSystem" TEXT,
    "externalId" TEXT,
    "quickbooksVendorId" TEXT,
    "quickbooksRealmId" TEXT,
    "quickbooksLastModifiedAt" TIMESTAMP(3),
    "lastSyncedAt" TIMESTAMP(3),
    "syncStatus" TEXT,
    "syncError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Vendor_pkey" PRIMARY KEY ("id")
);

-- CreateTable AccountingAccount
CREATE TABLE IF NOT EXISTS "AccountingAccount" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "accountType" TEXT NOT NULL,
    "classification" "AccountingClassification" NOT NULL DEFAULT 'OTHER',
    "fullyQualifiedName" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sourceSystem" TEXT,
    "externalId" TEXT,
    "quickbooksAccountId" TEXT,
    "quickbooksRealmId" TEXT,
    "lastSyncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AccountingAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable QuickBooksSyncRun
CREATE TABLE IF NOT EXISTS "QuickBooksSyncRun" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "initiatedById" TEXT,
    "realmId" TEXT NOT NULL,
    "environment" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "objectType" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "recordsExamined" INTEGER NOT NULL DEFAULT 0,
    "createdCount" INTEGER NOT NULL DEFAULT 0,
    "updatedCount" INTEGER NOT NULL DEFAULT 0,
    "linkedCount" INTEGER NOT NULL DEFAULT 0,
    "skippedCount" INTEGER NOT NULL DEFAULT 0,
    "conflictCount" INTEGER NOT NULL DEFAULT 0,
    "failedCount" INTEGER NOT NULL DEFAULT 0,
    "errorMessage" TEXT,
    "checkpoint" JSONB,
    "plan" JSONB,
    "writeBackAttempted" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QuickBooksSyncRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable QuickBooksSyncRunCategory
CREATE TABLE IF NOT EXISTS "QuickBooksSyncRunCategory" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "objectType" TEXT NOT NULL,
    "availableInQbo" INTEGER NOT NULL DEFAULT 0,
    "alreadyLinked" INTEGER NOT NULL DEFAULT 0,
    "newCount" INTEGER NOT NULL DEFAULT 0,
    "updatedCount" INTEGER NOT NULL DEFAULT 0,
    "duplicateCount" INTEGER NOT NULL DEFAULT 0,
    "conflictCount" INTEGER NOT NULL DEFAULT 0,
    "skippedCount" INTEGER NOT NULL DEFAULT 0,
    "failedCount" INTEGER NOT NULL DEFAULT 0,
    "lastSyncedAt" TIMESTAMP(3),
    "details" JSONB,

    CONSTRAINT "QuickBooksSyncRunCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable QuickBooksImportReview
CREATE TABLE IF NOT EXISTS "QuickBooksImportReview" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "runId" TEXT,
    "environment" TEXT NOT NULL,
    "realmId" TEXT NOT NULL,
    "objectType" TEXT NOT NULL,
    "quickbooksId" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "confidence" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "proposedInternalId" TEXT,
    "proposedAction" TEXT NOT NULL DEFAULT 'PENDING',
    "reason" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "matchSignals" JSONB,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QuickBooksImportReview_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "Customer_companyId_quickbooksCustomerId_idx" ON "Customer"("companyId", "quickbooksCustomerId");
CREATE INDEX IF NOT EXISTS "Customer_companyId_quickbooksRealmId_idx" ON "Customer"("companyId", "quickbooksRealmId");
CREATE UNIQUE INDEX IF NOT EXISTS "Customer_company_source_external_uidx"
  ON "Customer"("companyId", "sourceSystem", "externalId")
  WHERE "sourceSystem" IS NOT NULL AND "externalId" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "Invoice_companyId_quickbooksInvoiceId_idx" ON "Invoice"("companyId", "quickbooksInvoiceId");
CREATE UNIQUE INDEX IF NOT EXISTS "Invoice_company_source_external_uidx"
  ON "Invoice"("companyId", "sourceSystem", "externalId")
  WHERE "sourceSystem" IS NOT NULL AND "externalId" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "Payment_companyId_quickbooksPaymentId_idx" ON "Payment"("companyId", "quickbooksPaymentId");
CREATE UNIQUE INDEX IF NOT EXISTS "Payment_company_source_external_uidx"
  ON "Payment"("companyId", "sourceSystem", "externalId")
  WHERE "sourceSystem" IS NOT NULL AND "externalId" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "Expense_companyId_quickbooksPurchaseId_idx" ON "Expense"("companyId", "quickbooksPurchaseId");
CREATE INDEX IF NOT EXISTS "Expense_companyId_vendorId_idx" ON "Expense"("companyId", "vendorId");
CREATE INDEX IF NOT EXISTS "Expense_companyId_accountId_idx" ON "Expense"("companyId", "accountId");
CREATE UNIQUE INDEX IF NOT EXISTS "Expense_company_source_external_uidx"
  ON "Expense"("companyId", "sourceSystem", "externalId")
  WHERE "sourceSystem" IS NOT NULL AND "externalId" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "PricebookItem_companyId_sourceSystem_externalId_idx" ON "PricebookItem"("companyId", "sourceSystem", "externalId");
CREATE INDEX IF NOT EXISTS "PricebookItem_companyId_quickbooksItemId_idx" ON "PricebookItem"("companyId", "quickbooksItemId");
CREATE UNIQUE INDEX IF NOT EXISTS "PricebookItem_company_source_external_uidx"
  ON "PricebookItem"("companyId", "sourceSystem", "externalId")
  WHERE "sourceSystem" IS NOT NULL AND "externalId" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "Vendor_companyId_name_idx" ON "Vendor"("companyId", "name");
CREATE INDEX IF NOT EXISTS "Vendor_companyId_sourceSystem_externalId_idx" ON "Vendor"("companyId", "sourceSystem", "externalId");
CREATE INDEX IF NOT EXISTS "Vendor_companyId_quickbooksVendorId_idx" ON "Vendor"("companyId", "quickbooksVendorId");
CREATE UNIQUE INDEX IF NOT EXISTS "Vendor_company_source_external_uidx"
  ON "Vendor"("companyId", "sourceSystem", "externalId")
  WHERE "sourceSystem" IS NOT NULL AND "externalId" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "AccountingAccount_companyId_classification_idx" ON "AccountingAccount"("companyId", "classification");
CREATE INDEX IF NOT EXISTS "AccountingAccount_companyId_sourceSystem_externalId_idx" ON "AccountingAccount"("companyId", "sourceSystem", "externalId");
CREATE INDEX IF NOT EXISTS "AccountingAccount_companyId_quickbooksAccountId_idx" ON "AccountingAccount"("companyId", "quickbooksAccountId");
CREATE UNIQUE INDEX IF NOT EXISTS "AccountingAccount_company_source_external_uidx"
  ON "AccountingAccount"("companyId", "sourceSystem", "externalId")
  WHERE "sourceSystem" IS NOT NULL AND "externalId" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "QuickBooksSyncRun_companyId_createdAt_idx" ON "QuickBooksSyncRun"("companyId", "createdAt");
CREATE INDEX IF NOT EXISTS "QuickBooksSyncRun_companyId_environment_realmId_type_createdAt_idx" ON "QuickBooksSyncRun"("companyId", "environment", "realmId", "type", "createdAt");
CREATE INDEX IF NOT EXISTS "QuickBooksSyncRun_companyId_status_idx" ON "QuickBooksSyncRun"("companyId", "status");

CREATE UNIQUE INDEX IF NOT EXISTS "QuickBooksSyncRunCategory_runId_objectType_key" ON "QuickBooksSyncRunCategory"("runId", "objectType");
CREATE INDEX IF NOT EXISTS "QuickBooksSyncRunCategory_runId_idx" ON "QuickBooksSyncRunCategory"("runId");

CREATE UNIQUE INDEX IF NOT EXISTS "QuickBooksImportReview_companyId_environment_realmId_objectType_quickbooksId_key"
  ON "QuickBooksImportReview"("companyId", "environment", "realmId", "objectType", "quickbooksId");
CREATE INDEX IF NOT EXISTS "QuickBooksImportReview_companyId_status_objectType_idx" ON "QuickBooksImportReview"("companyId", "status", "objectType");
CREATE INDEX IF NOT EXISTS "QuickBooksImportReview_companyId_confidence_status_idx" ON "QuickBooksImportReview"("companyId", "confidence", "status");
CREATE INDEX IF NOT EXISTS "QuickBooksImportReview_runId_idx" ON "QuickBooksImportReview"("runId");

CREATE UNIQUE INDEX IF NOT EXISTS "QuickBooksMapping_scoped_entity_qbo_uidx"
  ON "QuickBooksMapping"("companyId", "environment", "realmId", "entityType", "quickbooksId")
  WHERE "ownershipStatus" = 'SCOPED' AND "environment" IS NOT NULL AND "realmId" IS NOT NULL;

DO $$ BEGIN
  ALTER TABLE "Vendor" ADD CONSTRAINT "Vendor_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "AccountingAccount" ADD CONSTRAINT "AccountingAccount_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "QuickBooksSyncRun" ADD CONSTRAINT "QuickBooksSyncRun_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "QuickBooksSyncRunCategory" ADD CONSTRAINT "QuickBooksSyncRunCategory_runId_fkey" FOREIGN KEY ("runId") REFERENCES "QuickBooksSyncRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "QuickBooksImportReview" ADD CONSTRAINT "QuickBooksImportReview_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "QuickBooksImportReview" ADD CONSTRAINT "QuickBooksImportReview_runId_fkey" FOREIGN KEY ("runId") REFERENCES "QuickBooksSyncRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "Expense" ADD CONSTRAINT "Expense_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "Expense" ADD CONSTRAINT "Expense_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "AccountingAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
