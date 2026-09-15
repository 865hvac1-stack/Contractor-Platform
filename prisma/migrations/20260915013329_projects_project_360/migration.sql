-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN     "projectId" TEXT;

-- AlterTable
ALTER TABLE "Job" ADD COLUMN     "projectId" TEXT,
ADD COLUMN     "projectPhaseId" TEXT,
ADD COLUMN     "projectVisitPurpose" TEXT;

-- AlterTable
ALTER TABLE "Membership" ADD COLUMN     "internalJobCostRateCents" INTEGER;

-- AlterTable
ALTER TABLE "Receipt" ADD COLUMN     "projectId" TEXT,
ADD COLUMN     "projectPhaseId" TEXT;

-- CreateTable
CREATE TABLE "Project" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "projectNumber" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'CUSTOM',
    "status" TEXT NOT NULL DEFAULT 'PLANNING',
    "builderName" TEXT,
    "primaryContactName" TEXT,
    "primaryContactPhone" TEXT,
    "projectManagerId" TEXT,
    "nextStep" TEXT,
    "nextStepOverride" BOOLEAN NOT NULL DEFAULT false,
    "originalContractCents" INTEGER NOT NULL DEFAULT 0,
    "laborBudgetMinutes" INTEGER,
    "laborBudgetCostCents" INTEGER,
    "equipmentBudgetCents" INTEGER,
    "materialsBudgetCents" INTEGER,
    "otherBudgetCents" INTEGER,
    "estimatedStart" TIMESTAMP(3),
    "targetCompletion" TIMESTAMP(3),
    "actualStart" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "completionOverrideReason" TEXT,
    "minimumMarginBps" INTEGER NOT NULL DEFAULT 2000,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Project_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectPhase" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'NOT_STARTED',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "plannedStart" TIMESTAMP(3),
    "actualStart" TIMESTAMP(3),
    "plannedCompletion" TIMESTAMP(3),
    "actualCompletion" TIMESTAMP(3),
    "ownerUserId" TEXT,
    "notes" TEXT,
    "waitingReason" TEXT,
    "laborBudgetMinutes" INTEGER,
    "laborBudgetCostCents" INTEGER,
    "materialsNeededSummary" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectPhase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectLaborEntry" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "phaseId" TEXT,
    "jobId" TEXT,
    "employeeId" TEXT NOT NULL,
    "workDate" TIMESTAMP(3) NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3),
    "breakMinutes" INTEGER NOT NULL DEFAULT 0,
    "totalMinutes" INTEGER,
    "workCategory" TEXT,
    "internalCostRateCents" INTEGER NOT NULL DEFAULT 0,
    "internalLaborCostCents" INTEGER,
    "notes" TEXT,
    "source" TEXT NOT NULL DEFAULT 'TECH_CLOCK',
    "createdById" TEXT NOT NULL,
    "editedById" TEXT,
    "editReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectLaborEntry_pkey" PRIMARY KEY ("id")
);

-- One active project clock per employee per tenant. Manual corrections retain history.
CREATE UNIQUE INDEX "ProjectLaborEntry_one_active_clock_per_employee"
ON "ProjectLaborEntry"("companyId", "employeeId")
WHERE "endedAt" IS NULL;

ALTER TABLE "ProjectLaborEntry"
  ADD CONSTRAINT "ProjectLaborEntry_nonnegative_break" CHECK ("breakMinutes" >= 0),
  ADD CONSTRAINT "ProjectLaborEntry_nonnegative_minutes" CHECK ("totalMinutes" IS NULL OR "totalMinutes" >= 0),
  ADD CONSTRAINT "ProjectLaborEntry_valid_interval" CHECK ("endedAt" IS NULL OR "endedAt" >= "startedAt");

-- CreateTable
CREATE TABLE "ProjectLaborRevision" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "laborEntryId" TEXT NOT NULL,
    "changedById" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "before" JSONB NOT NULL,
    "after" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectLaborRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectCost" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "phaseId" TEXT,
    "receiptId" TEXT,
    "jobCostId" TEXT,
    "description" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTUAL',
    "vendor" TEXT,
    "incurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sourceType" TEXT NOT NULL DEFAULT 'MANUAL',
    "sourceId" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "notes" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectCost_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectMaterial" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "phaseId" TEXT,
    "partId" TEXT NOT NULL,
    "linkedJobId" TEXT,
    "linkedJobPartId" TEXT,
    "quantity" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'NEEDED',
    "unitCostCents" INTEGER NOT NULL,
    "costTreatment" TEXT NOT NULL DEFAULT 'INVENTORY_ALLOCATION',
    "neededBy" TIMESTAMP(3),
    "notes" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectMaterial_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectMaterialRequest" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "phaseId" TEXT,
    "partId" TEXT,
    "description" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "neededBy" TIMESTAMP(3),
    "urgency" TEXT NOT NULL DEFAULT 'NORMAL',
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "notes" TEXT,
    "requestedById" TEXT NOT NULL,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectMaterialRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectAsset" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "phaseId" TEXT,
    "jobId" TEXT,
    "kind" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "title" TEXT,
    "note" TEXT,
    "fileName" TEXT NOT NULL,
    "filePath" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "fileSizeBytes" INTEGER NOT NULL,
    "uploadedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectAsset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectIssue" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "phaseId" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "priority" TEXT NOT NULL DEFAULT 'NORMAL',
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "assignedToId" TEXT,
    "createdById" TEXT NOT NULL,
    "dueDate" TIMESTAMP(3),
    "resolutionNotes" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectIssue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectChangeOrder" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "phaseId" TEXT,
    "number" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "reason" TEXT,
    "revenueChangeCents" INTEGER NOT NULL DEFAULT 0,
    "estimatedCostChangeCents" INTEGER NOT NULL DEFAULT 0,
    "laborMinutesChange" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approvedAt" TIMESTAMP(3),
    "approvedById" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectChangeOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectBillingMilestone" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "invoiceId" TEXT,
    "name" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "percentBps" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'NOT_READY',
    "dueAt" TIMESTAMP(3),
    "readyAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectBillingMilestone_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectContact" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "companyName" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "customerId" TEXT,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectContact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectActivity" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "phaseId" TEXT,
    "actorId" TEXT,
    "event" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "details" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectActivity_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Project_companyId_status_updatedAt_idx" ON "Project"("companyId", "status", "updatedAt");

-- CreateIndex
CREATE INDEX "Project_companyId_customerId_idx" ON "Project"("companyId", "customerId");

-- CreateIndex
CREATE INDEX "Project_companyId_propertyId_idx" ON "Project"("companyId", "propertyId");

-- CreateIndex
CREATE INDEX "Project_companyId_type_idx" ON "Project"("companyId", "type");

-- CreateIndex
CREATE INDEX "Project_companyId_projectManagerId_idx" ON "Project"("companyId", "projectManagerId");

-- CreateIndex
CREATE UNIQUE INDEX "Project_companyId_projectNumber_key" ON "Project"("companyId", "projectNumber");

-- CreateIndex
CREATE INDEX "ProjectPhase_companyId_projectId_status_idx" ON "ProjectPhase"("companyId", "projectId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectPhase_projectId_sortOrder_key" ON "ProjectPhase"("projectId", "sortOrder");

-- CreateIndex
CREATE INDEX "ProjectLaborEntry_companyId_projectId_workDate_idx" ON "ProjectLaborEntry"("companyId", "projectId", "workDate");

-- CreateIndex
CREATE INDEX "ProjectLaborEntry_companyId_phaseId_workDate_idx" ON "ProjectLaborEntry"("companyId", "phaseId", "workDate");

-- CreateIndex
CREATE INDEX "ProjectLaborEntry_companyId_employeeId_workDate_idx" ON "ProjectLaborEntry"("companyId", "employeeId", "workDate");

-- CreateIndex
CREATE INDEX "ProjectLaborEntry_companyId_employeeId_endedAt_idx" ON "ProjectLaborEntry"("companyId", "employeeId", "endedAt");

-- CreateIndex
CREATE INDEX "ProjectLaborRevision_companyId_laborEntryId_createdAt_idx" ON "ProjectLaborRevision"("companyId", "laborEntryId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectCost_receiptId_key" ON "ProjectCost"("receiptId");

-- CreateIndex
CREATE INDEX "ProjectCost_companyId_projectId_status_category_idx" ON "ProjectCost"("companyId", "projectId", "status", "category");

-- CreateIndex
CREATE INDEX "ProjectCost_companyId_phaseId_idx" ON "ProjectCost"("companyId", "phaseId");

-- CreateIndex
CREATE INDEX "ProjectCost_companyId_jobCostId_idx" ON "ProjectCost"("companyId", "jobCostId");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectCost_companyId_idempotencyKey_key" ON "ProjectCost"("companyId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "ProjectMaterial_companyId_projectId_status_idx" ON "ProjectMaterial"("companyId", "projectId", "status");

-- CreateIndex
CREATE INDEX "ProjectMaterial_companyId_phaseId_idx" ON "ProjectMaterial"("companyId", "phaseId");

-- CreateIndex
CREATE INDEX "ProjectMaterial_companyId_partId_idx" ON "ProjectMaterial"("companyId", "partId");

-- CreateIndex
CREATE INDEX "ProjectMaterialRequest_companyId_projectId_status_idx" ON "ProjectMaterialRequest"("companyId", "projectId", "status");

-- CreateIndex
CREATE INDEX "ProjectAsset_companyId_projectId_kind_createdAt_idx" ON "ProjectAsset"("companyId", "projectId", "kind", "createdAt");

-- CreateIndex
CREATE INDEX "ProjectAsset_companyId_phaseId_idx" ON "ProjectAsset"("companyId", "phaseId");

-- CreateIndex
CREATE INDEX "ProjectIssue_companyId_projectId_status_priority_idx" ON "ProjectIssue"("companyId", "projectId", "status", "priority");

-- CreateIndex
CREATE INDEX "ProjectIssue_companyId_assignedToId_status_idx" ON "ProjectIssue"("companyId", "assignedToId", "status");

-- CreateIndex
CREATE INDEX "ProjectChangeOrder_companyId_projectId_status_idx" ON "ProjectChangeOrder"("companyId", "projectId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectChangeOrder_projectId_number_key" ON "ProjectChangeOrder"("projectId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectBillingMilestone_invoiceId_key" ON "ProjectBillingMilestone"("invoiceId");

-- CreateIndex
CREATE INDEX "ProjectBillingMilestone_companyId_projectId_status_idx" ON "ProjectBillingMilestone"("companyId", "projectId", "status");

-- CreateIndex
CREATE INDEX "ProjectContact_companyId_projectId_role_idx" ON "ProjectContact"("companyId", "projectId", "role");

-- CreateIndex
CREATE INDEX "ProjectContact_companyId_customerId_idx" ON "ProjectContact"("companyId", "customerId");

-- CreateIndex
CREATE INDEX "ProjectActivity_companyId_projectId_createdAt_idx" ON "ProjectActivity"("companyId", "projectId", "createdAt");

-- CreateIndex
CREATE INDEX "ProjectActivity_companyId_event_createdAt_idx" ON "ProjectActivity"("companyId", "event", "createdAt");

-- CreateIndex
CREATE INDEX "Invoice_companyId_projectId_idx" ON "Invoice"("companyId", "projectId");

-- CreateIndex
CREATE INDEX "Job_companyId_projectId_scheduledStart_idx" ON "Job"("companyId", "projectId", "scheduledStart");

-- CreateIndex
CREATE INDEX "Job_companyId_projectPhaseId_idx" ON "Job"("companyId", "projectPhaseId");

-- CreateIndex
CREATE INDEX "Receipt_companyId_projectId_idx" ON "Receipt"("companyId", "projectId");

-- AddForeignKey
ALTER TABLE "Job" ADD CONSTRAINT "Job_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Job" ADD CONSTRAINT "Job_projectPhaseId_fkey" FOREIGN KEY ("projectPhaseId") REFERENCES "ProjectPhase"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Receipt" ADD CONSTRAINT "Receipt_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Receipt" ADD CONSTRAINT "Receipt_projectPhaseId_fkey" FOREIGN KEY ("projectPhaseId") REFERENCES "ProjectPhase"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectPhase" ADD CONSTRAINT "ProjectPhase_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectPhase" ADD CONSTRAINT "ProjectPhase_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectLaborEntry" ADD CONSTRAINT "ProjectLaborEntry_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectLaborEntry" ADD CONSTRAINT "ProjectLaborEntry_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectLaborEntry" ADD CONSTRAINT "ProjectLaborEntry_phaseId_fkey" FOREIGN KEY ("phaseId") REFERENCES "ProjectPhase"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectLaborEntry" ADD CONSTRAINT "ProjectLaborEntry_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectLaborEntry" ADD CONSTRAINT "ProjectLaborEntry_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectLaborEntry" ADD CONSTRAINT "ProjectLaborEntry_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectLaborEntry" ADD CONSTRAINT "ProjectLaborEntry_editedById_fkey" FOREIGN KEY ("editedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectLaborRevision" ADD CONSTRAINT "ProjectLaborRevision_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectLaborRevision" ADD CONSTRAINT "ProjectLaborRevision_laborEntryId_fkey" FOREIGN KEY ("laborEntryId") REFERENCES "ProjectLaborEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectLaborRevision" ADD CONSTRAINT "ProjectLaborRevision_changedById_fkey" FOREIGN KEY ("changedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectCost" ADD CONSTRAINT "ProjectCost_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectCost" ADD CONSTRAINT "ProjectCost_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectCost" ADD CONSTRAINT "ProjectCost_phaseId_fkey" FOREIGN KEY ("phaseId") REFERENCES "ProjectPhase"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectCost" ADD CONSTRAINT "ProjectCost_receiptId_fkey" FOREIGN KEY ("receiptId") REFERENCES "Receipt"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectMaterial" ADD CONSTRAINT "ProjectMaterial_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectMaterial" ADD CONSTRAINT "ProjectMaterial_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectMaterial" ADD CONSTRAINT "ProjectMaterial_phaseId_fkey" FOREIGN KEY ("phaseId") REFERENCES "ProjectPhase"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectMaterial" ADD CONSTRAINT "ProjectMaterial_partId_fkey" FOREIGN KEY ("partId") REFERENCES "PricebookItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectMaterialRequest" ADD CONSTRAINT "ProjectMaterialRequest_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectMaterialRequest" ADD CONSTRAINT "ProjectMaterialRequest_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectMaterialRequest" ADD CONSTRAINT "ProjectMaterialRequest_phaseId_fkey" FOREIGN KEY ("phaseId") REFERENCES "ProjectPhase"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectMaterialRequest" ADD CONSTRAINT "ProjectMaterialRequest_partId_fkey" FOREIGN KEY ("partId") REFERENCES "PricebookItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectAsset" ADD CONSTRAINT "ProjectAsset_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectAsset" ADD CONSTRAINT "ProjectAsset_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectAsset" ADD CONSTRAINT "ProjectAsset_phaseId_fkey" FOREIGN KEY ("phaseId") REFERENCES "ProjectPhase"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectIssue" ADD CONSTRAINT "ProjectIssue_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectIssue" ADD CONSTRAINT "ProjectIssue_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectIssue" ADD CONSTRAINT "ProjectIssue_phaseId_fkey" FOREIGN KEY ("phaseId") REFERENCES "ProjectPhase"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectChangeOrder" ADD CONSTRAINT "ProjectChangeOrder_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectChangeOrder" ADD CONSTRAINT "ProjectChangeOrder_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectChangeOrder" ADD CONSTRAINT "ProjectChangeOrder_phaseId_fkey" FOREIGN KEY ("phaseId") REFERENCES "ProjectPhase"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectBillingMilestone" ADD CONSTRAINT "ProjectBillingMilestone_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectBillingMilestone" ADD CONSTRAINT "ProjectBillingMilestone_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectBillingMilestone" ADD CONSTRAINT "ProjectBillingMilestone_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectContact" ADD CONSTRAINT "ProjectContact_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectContact" ADD CONSTRAINT "ProjectContact_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectActivity" ADD CONSTRAINT "ProjectActivity_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectActivity" ADD CONSTRAINT "ProjectActivity_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectActivity" ADD CONSTRAINT "ProjectActivity_phaseId_fkey" FOREIGN KEY ("phaseId") REFERENCES "ProjectPhase"("id") ON DELETE SET NULL ON UPDATE CASCADE;
