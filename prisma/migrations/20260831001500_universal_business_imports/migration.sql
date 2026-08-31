-- AlterTable
ALTER TABLE "Customer" ADD COLUMN "importMode" TEXT NOT NULL DEFAULT 'LIVE';

-- AlterTable
ALTER TABLE "Property" ADD COLUMN "sourceSystem" TEXT,
ADD COLUMN "externalId" TEXT,
ADD COLUMN "importMode" TEXT NOT NULL DEFAULT 'LIVE';

-- AlterTable
ALTER TABLE "Equipment" ADD COLUMN "sourceSystem" TEXT,
ADD COLUMN "externalId" TEXT,
ADD COLUMN "importSessionId" TEXT,
ADD COLUMN "importMode" TEXT NOT NULL DEFAULT 'LIVE';

-- AlterTable
ALTER TABLE "Job" ADD COLUMN "sourceSystem" TEXT,
ADD COLUMN "externalId" TEXT,
ADD COLUMN "importSessionId" TEXT,
ADD COLUMN "importMode" TEXT NOT NULL DEFAULT 'LIVE',
ADD COLUMN "importedTechnicianName" TEXT;

-- AlterTable
ALTER TABLE "Estimate" ADD COLUMN "sourceSystem" TEXT,
ADD COLUMN "externalId" TEXT,
ADD COLUMN "importSessionId" TEXT,
ADD COLUMN "importMode" TEXT NOT NULL DEFAULT 'LIVE';

-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN "sourceSystem" TEXT,
ADD COLUMN "externalId" TEXT,
ADD COLUMN "importSessionId" TEXT,
ADD COLUMN "importMode" TEXT NOT NULL DEFAULT 'LIVE';

-- AlterTable
ALTER TABLE "Payment" ADD COLUMN "sourceSystem" TEXT,
ADD COLUMN "externalId" TEXT,
ADD COLUMN "importSessionId" TEXT,
ADD COLUMN "importMode" TEXT NOT NULL DEFAULT 'LIVE';

-- AlterTable
ALTER TABLE "Expense" ADD COLUMN "sourceSystem" TEXT,
ADD COLUMN "externalId" TEXT,
ADD COLUMN "importSessionId" TEXT,
ADD COLUMN "importMode" TEXT NOT NULL DEFAULT 'LIVE';

-- AlterTable
ALTER TABLE "ImportSession" ADD COLUMN "importMode" TEXT NOT NULL DEFAULT 'HISTORICAL',
ADD COLUMN "detectedRecordType" "ImportRecordType",
ADD COLUMN "rowAccounting" JSONB,
ADD COLUMN "qualityScore" JSONB,
ADD COLUMN "migrationProjectId" TEXT;

-- CreateTable
CREATE TABLE "MigrationProject" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sourceType" "ImportSourceType" NOT NULL DEFAULT 'UNKNOWN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MigrationProject_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Property_companyId_sourceSystem_externalId_idx" ON "Property"("companyId", "sourceSystem", "externalId");

-- CreateIndex
CREATE INDEX "Equipment_companyId_sourceSystem_externalId_idx" ON "Equipment"("companyId", "sourceSystem", "externalId");

-- CreateIndex
CREATE INDEX "Equipment_companyId_importSessionId_idx" ON "Equipment"("companyId", "importSessionId");

-- CreateIndex
CREATE INDEX "Job_companyId_sourceSystem_externalId_idx" ON "Job"("companyId", "sourceSystem", "externalId");

-- CreateIndex
CREATE INDEX "Job_companyId_importSessionId_idx" ON "Job"("companyId", "importSessionId");

-- CreateIndex
CREATE INDEX "Estimate_companyId_sourceSystem_externalId_idx" ON "Estimate"("companyId", "sourceSystem", "externalId");

-- CreateIndex
CREATE INDEX "Estimate_companyId_importSessionId_idx" ON "Estimate"("companyId", "importSessionId");

-- CreateIndex
CREATE INDEX "Invoice_companyId_sourceSystem_externalId_idx" ON "Invoice"("companyId", "sourceSystem", "externalId");

-- CreateIndex
CREATE INDEX "Invoice_companyId_importSessionId_idx" ON "Invoice"("companyId", "importSessionId");

-- CreateIndex
CREATE INDEX "Payment_companyId_sourceSystem_externalId_idx" ON "Payment"("companyId", "sourceSystem", "externalId");

-- CreateIndex
CREATE INDEX "Payment_companyId_importSessionId_idx" ON "Payment"("companyId", "importSessionId");

-- CreateIndex
CREATE INDEX "Expense_companyId_sourceSystem_externalId_idx" ON "Expense"("companyId", "sourceSystem", "externalId");

-- CreateIndex
CREATE INDEX "Expense_companyId_importSessionId_idx" ON "Expense"("companyId", "importSessionId");

-- CreateIndex
CREATE INDEX "MigrationProject_companyId_createdAt_idx" ON "MigrationProject"("companyId", "createdAt");

-- CreateIndex
CREATE INDEX "ImportSession_companyId_migrationProjectId_idx" ON "ImportSession"("companyId", "migrationProjectId");

-- AddForeignKey
ALTER TABLE "Equipment" ADD CONSTRAINT "Equipment_importSessionId_fkey" FOREIGN KEY ("importSessionId") REFERENCES "ImportSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Job" ADD CONSTRAINT "Job_importSessionId_fkey" FOREIGN KEY ("importSessionId") REFERENCES "ImportSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Estimate" ADD CONSTRAINT "Estimate_importSessionId_fkey" FOREIGN KEY ("importSessionId") REFERENCES "ImportSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_importSessionId_fkey" FOREIGN KEY ("importSessionId") REFERENCES "ImportSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_importSessionId_fkey" FOREIGN KEY ("importSessionId") REFERENCES "ImportSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_importSessionId_fkey" FOREIGN KEY ("importSessionId") REFERENCES "ImportSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MigrationProject" ADD CONSTRAINT "MigrationProject_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportSession" ADD CONSTRAINT "ImportSession_migrationProjectId_fkey" FOREIGN KEY ("migrationProjectId") REFERENCES "MigrationProject"("id") ON DELETE SET NULL ON UPDATE CASCADE;
