-- AlterTable
ALTER TABLE "Customer" ADD COLUMN     "externalId" TEXT,
ADD COLUMN     "importSessionId" TEXT,
ADD COLUMN     "sourceSystem" TEXT;

-- AlterTable
ALTER TABLE "Property" ADD COLUMN     "importSessionId" TEXT;

-- CreateEnum
CREATE TYPE "ImportRecordType" AS ENUM ('CUSTOMERS', 'PROPERTIES', 'CONTACTS', 'JOBS', 'ESTIMATES', 'INVOICES', 'PAYMENTS', 'EQUIPMENT', 'MEMBERSHIPS', 'NOTES', 'TAGS', 'LEAD_SOURCES', 'EXPENSES', 'PRICEBOOK', 'COMMUNICATIONS', 'OTHER');

-- CreateEnum
CREATE TYPE "ImportSourceType" AS ENUM ('HOUSECALL_PRO', 'SERVICETITAN', 'JOBBER', 'FIELDEDGE', 'SERVICE_FUSION', 'WORKIZ', 'QUICKBOOKS', 'HUBSPOT', 'SALESFORCE', 'SPREADSHEET', 'OTHER', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "ImportSessionStatus" AS ENUM ('UPLOADED', 'ANALYZING', 'MAPPING_REQUIRED', 'READY_FOR_PREVIEW', 'READY_TO_IMPORT', 'IMPORTING', 'COMPLETED', 'PARTIAL', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ImportRowStatus" AS ENUM ('PENDING', 'VALID', 'WARNING', 'ERROR', 'IMPORTED', 'SKIPPED', 'FAILED');

-- CreateEnum
CREATE TYPE "ImportRowAction" AS ENUM ('CREATE', 'UPDATE', 'MERGE', 'SKIP', 'ERROR');

-- CreateEnum
CREATE TYPE "ImportDuplicateVerdict" AS ENUM ('NEW', 'LIKELY_DUPLICATE', 'EXACT_MATCH', 'NEEDS_REVIEW');

-- CreateTable
CREATE TABLE "ImportSession" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "recordType" "ImportRecordType" NOT NULL,
    "sourceType" "ImportSourceType" NOT NULL,
    "fileName" TEXT NOT NULL,
    "fileHash" TEXT NOT NULL,
    "mimeType" TEXT,
    "encoding" TEXT,
    "status" "ImportSessionStatus" NOT NULL DEFAULT 'UPLOADED',
    "rowCount" INTEGER NOT NULL DEFAULT 0,
    "analysis" JSONB,
    "mapping" JSONB,
    "previewSummary" JSONB,
    "importSummary" JSONB,
    "intelligence" TEXT,
    "errorMessage" TEXT,
    "duplicatePolicy" TEXT NOT NULL DEFAULT 'SKIP',
    "confirmedAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "processedRows" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ImportSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImportRow" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "importSessionId" TEXT NOT NULL,
    "rowNumber" INTEGER NOT NULL,
    "status" "ImportRowStatus" NOT NULL DEFAULT 'PENDING',
    "action" "ImportRowAction" NOT NULL DEFAULT 'CREATE',
    "duplicateVerdict" "ImportDuplicateVerdict" NOT NULL DEFAULT 'NEW',
    "rawData" JSONB NOT NULL,
    "normalizedData" JSONB,
    "mappedData" JSONB,
    "issues" JSONB,
    "targetRecordId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ImportRow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImportExternalRef" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "sourceSystem" "ImportSourceType" NOT NULL,
    "recordType" "ImportRecordType" NOT NULL,
    "externalId" TEXT NOT NULL,
    "targetRecordId" TEXT NOT NULL,
    "importSessionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ImportExternalRef_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImportMappingProfile" (
    "id" TEXT NOT NULL,
    "companyId" TEXT,
    "sourceType" "ImportSourceType" NOT NULL,
    "recordType" "ImportRecordType" NOT NULL,
    "name" TEXT NOT NULL,
    "headerFingerprint" TEXT NOT NULL,
    "mapping" JSONB NOT NULL,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ImportMappingProfile_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Customer_companyId_sourceSystem_externalId_idx" ON "Customer"("companyId", "sourceSystem", "externalId");

-- CreateIndex
CREATE INDEX "Customer_companyId_importSessionId_idx" ON "Customer"("companyId", "importSessionId");

-- CreateIndex
CREATE INDEX "Property_companyId_importSessionId_idx" ON "Property"("companyId", "importSessionId");

-- CreateIndex
CREATE INDEX "ImportSession_companyId_createdAt_idx" ON "ImportSession"("companyId", "createdAt");

-- CreateIndex
CREATE INDEX "ImportSession_companyId_status_idx" ON "ImportSession"("companyId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ImportRow_importSessionId_rowNumber_key" ON "ImportRow"("importSessionId", "rowNumber");

-- CreateIndex
CREATE INDEX "ImportRow_companyId_importSessionId_idx" ON "ImportRow"("companyId", "importSessionId");

-- CreateIndex
CREATE INDEX "ImportRow_importSessionId_status_idx" ON "ImportRow"("importSessionId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ImportExternalRef_companyId_sourceSystem_recordType_externalId_key" ON "ImportExternalRef"("companyId", "sourceSystem", "recordType", "externalId");

-- CreateIndex
CREATE INDEX "ImportExternalRef_companyId_recordType_targetRecordId_idx" ON "ImportExternalRef"("companyId", "recordType", "targetRecordId");

-- CreateIndex
CREATE INDEX "ImportMappingProfile_sourceType_recordType_idx" ON "ImportMappingProfile"("sourceType", "recordType");

-- AddForeignKey
ALTER TABLE "Customer" ADD CONSTRAINT "Customer_importSessionId_fkey" FOREIGN KEY ("importSessionId") REFERENCES "ImportSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Property" ADD CONSTRAINT "Property_importSessionId_fkey" FOREIGN KEY ("importSessionId") REFERENCES "ImportSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportSession" ADD CONSTRAINT "ImportSession_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportSession" ADD CONSTRAINT "ImportSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportRow" ADD CONSTRAINT "ImportRow_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportRow" ADD CONSTRAINT "ImportRow_importSessionId_fkey" FOREIGN KEY ("importSessionId") REFERENCES "ImportSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportExternalRef" ADD CONSTRAINT "ImportExternalRef_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportExternalRef" ADD CONSTRAINT "ImportExternalRef_importSessionId_fkey" FOREIGN KEY ("importSessionId") REFERENCES "ImportSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportMappingProfile" ADD CONSTRAINT "ImportMappingProfile_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
