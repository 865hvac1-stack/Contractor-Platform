-- CreateEnum
CREATE TYPE "PlaybookStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'ARCHIVED');

-- AlterTable
ALTER TABLE "Automation" ADD COLUMN     "playbookId" TEXT;

-- AlterTable
ALTER TABLE "Equipment" ADD COLUMN     "equipmentType" TEXT,
ADD COLUMN     "location" TEXT,
ADD COLUMN     "warrantyExpiresAt" TIMESTAMP(3),
ADD COLUMN     "warrantyNotes" TEXT;

-- AlterTable
ALTER TABLE "Job" ADD COLUMN     "playbookId" TEXT,
ADD COLUMN     "playbookVersionId" TEXT;

-- CreateTable
CREATE TABLE "Playbook" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" "PlaybookStatus" NOT NULL DEFAULT 'ACTIVE',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "currentVersionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Playbook_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlaybookVersion" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "playbookId" TEXT NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "definition" JSONB NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlaybookVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobPlaybookSnapshot" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "playbookId" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "definition" JSONB NOT NULL,
    "currentStageKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JobPlaybookSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobWorkflowEvent" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "stepId" TEXT NOT NULL,
    "actorId" TEXT,
    "kind" TEXT NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JobWorkflowEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobChecklistItem" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "section" TEXT,
    "label" TEXT NOT NULL,
    "required" BOOLEAN NOT NULL DEFAULT false,
    "fieldType" TEXT NOT NULL DEFAULT 'CHECKBOX',
    "completed" BOOLEAN NOT NULL DEFAULT false,
    "value" TEXT,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JobChecklistItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FormTemplate" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "playbookId" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "fields" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FormTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Playbook_companyId_idx" ON "Playbook"("companyId");

-- CreateIndex
CREATE INDEX "Playbook_companyId_status_idx" ON "Playbook"("companyId", "status");

-- CreateIndex
CREATE INDEX "Playbook_companyId_sortOrder_idx" ON "Playbook"("companyId", "sortOrder");

-- CreateIndex
CREATE INDEX "PlaybookVersion_companyId_idx" ON "PlaybookVersion"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "PlaybookVersion_playbookId_versionNumber_key" ON "PlaybookVersion"("playbookId", "versionNumber");

-- CreateIndex
CREATE UNIQUE INDEX "JobPlaybookSnapshot_jobId_key" ON "JobPlaybookSnapshot"("jobId");

-- CreateIndex
CREATE INDEX "JobPlaybookSnapshot_companyId_idx" ON "JobPlaybookSnapshot"("companyId");

-- CreateIndex
CREATE INDEX "JobPlaybookSnapshot_companyId_playbookId_idx" ON "JobPlaybookSnapshot"("companyId", "playbookId");

-- CreateIndex
CREATE INDEX "JobWorkflowEvent_companyId_jobId_idx" ON "JobWorkflowEvent"("companyId", "jobId");

-- CreateIndex
CREATE INDEX "JobChecklistItem_companyId_jobId_idx" ON "JobChecklistItem"("companyId", "jobId");

-- CreateIndex
CREATE UNIQUE INDEX "JobChecklistItem_jobId_itemId_key" ON "JobChecklistItem"("jobId", "itemId");

-- CreateIndex
CREATE INDEX "FormTemplate_companyId_idx" ON "FormTemplate"("companyId");

-- CreateIndex
CREATE INDEX "FormTemplate_companyId_playbookId_idx" ON "FormTemplate"("companyId", "playbookId");

-- CreateIndex
CREATE INDEX "Automation_companyId_playbookId_idx" ON "Automation"("companyId", "playbookId");

-- CreateIndex
CREATE INDEX "Job_companyId_playbookId_idx" ON "Job"("companyId", "playbookId");

-- AddForeignKey
ALTER TABLE "Job" ADD CONSTRAINT "Job_playbookId_fkey" FOREIGN KEY ("playbookId") REFERENCES "Playbook"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Job" ADD CONSTRAINT "Job_playbookVersionId_fkey" FOREIGN KEY ("playbookVersionId") REFERENCES "PlaybookVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Automation" ADD CONSTRAINT "Automation_playbookId_fkey" FOREIGN KEY ("playbookId") REFERENCES "Playbook"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Playbook" ADD CONSTRAINT "Playbook_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlaybookVersion" ADD CONSTRAINT "PlaybookVersion_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlaybookVersion" ADD CONSTRAINT "PlaybookVersion_playbookId_fkey" FOREIGN KEY ("playbookId") REFERENCES "Playbook"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlaybookVersion" ADD CONSTRAINT "PlaybookVersion_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobPlaybookSnapshot" ADD CONSTRAINT "JobPlaybookSnapshot_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobPlaybookSnapshot" ADD CONSTRAINT "JobPlaybookSnapshot_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobPlaybookSnapshot" ADD CONSTRAINT "JobPlaybookSnapshot_playbookId_fkey" FOREIGN KEY ("playbookId") REFERENCES "Playbook"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobPlaybookSnapshot" ADD CONSTRAINT "JobPlaybookSnapshot_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "PlaybookVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobWorkflowEvent" ADD CONSTRAINT "JobWorkflowEvent_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobWorkflowEvent" ADD CONSTRAINT "JobWorkflowEvent_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobWorkflowEvent" ADD CONSTRAINT "JobWorkflowEvent_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobChecklistItem" ADD CONSTRAINT "JobChecklistItem_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobChecklistItem" ADD CONSTRAINT "JobChecklistItem_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FormTemplate" ADD CONSTRAINT "FormTemplate_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FormTemplate" ADD CONSTRAINT "FormTemplate_playbookId_fkey" FOREIGN KEY ("playbookId") REFERENCES "Playbook"("id") ON DELETE SET NULL ON UPDATE CASCADE;
