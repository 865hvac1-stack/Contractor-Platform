-- AlterEnum
ALTER TYPE "InvoiceStatus" ADD VALUE IF NOT EXISTS 'REFUNDED';
ALTER TYPE "InvoiceStatus" ADD VALUE IF NOT EXISTS 'PARTIALLY_REFUNDED';

-- CreateEnum
CREATE TYPE "PricebookItemType" AS ENUM ('SERVICE', 'PRODUCT', 'MATERIAL', 'ADD_ON', 'MEMBERSHIP', 'BUNDLE', 'OTHER');
CREATE TYPE "CustomerMembershipStatus" AS ENUM ('PENDING', 'ACTIVE', 'PAST_DUE', 'CANCELLED', 'EXPIRED');
CREATE TYPE "CompensationRuleType" AS ENUM ('FLAT_AMOUNT', 'PERCENT_OF_SALE', 'PERCENT_OF_GROSS_PROFIT', 'TIERED', 'THRESHOLD_BONUS');
CREATE TYPE "CompensationTrigger" AS ENUM ('PRICEBOOK_ITEM_SOLD', 'MEMBERSHIP_SOLD', 'ESTIMATE_APPROVED', 'INVOICE_PAID', 'JOB_COMPLETED', 'REVENUE_THRESHOLD', 'MARGIN_THRESHOLD');
CREATE TYPE "CompensationStatus" AS ENUM ('PENDING', 'QUALIFIED', 'APPROVED', 'PAID', 'VOIDED');

-- AlterTable Estimate
ALTER TABLE "Estimate" ADD COLUMN "publicToken" TEXT;
ALTER TABLE "Estimate" ADD COLUMN "createdById" TEXT;
ALTER TABLE "Estimate" ADD COLUMN "approvedOptionId" TEXT;
ALTER TABLE "Estimate" ADD COLUMN "approvalMethod" TEXT;
ALTER TABLE "Estimate" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;
CREATE UNIQUE INDEX "Estimate_publicToken_key" ON "Estimate"("publicToken");

-- AlterTable EstimateLineItem
ALTER TABLE "EstimateLineItem" ADD COLUMN "optionId" TEXT;
ALTER TABLE "EstimateLineItem" ADD COLUMN "pricebookItemId" TEXT;
CREATE INDEX "EstimateLineItem_optionId_idx" ON "EstimateLineItem"("optionId");

-- AlterTable Invoice
ALTER TABLE "Invoice" ADD COLUMN "publicToken" TEXT;
CREATE UNIQUE INDEX "Invoice_publicToken_key" ON "Invoice"("publicToken");

-- AlterTable Payment
ALTER TABLE "Payment" ADD COLUMN "customerId" TEXT;
ALTER TABLE "Payment" ADD COLUMN "jobId" TEXT;
ALTER TABLE "Payment" ADD COLUMN "provider" TEXT NOT NULL DEFAULT 'MANUAL';
ALTER TABLE "Payment" ADD COLUMN "providerPaymentId" TEXT;
ALTER TABLE "Payment" ADD COLUMN "recordedById" TEXT;
ALTER TABLE "Payment" ADD COLUMN "reference" TEXT;
CREATE UNIQUE INDEX "Payment_companyId_provider_providerPaymentId_key" ON "Payment"("companyId", "provider", "providerPaymentId");

-- CreateTable
CREATE TABLE "PricebookCategory" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "parentId" TEXT,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PricebookCategory_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "PricebookCategory_companyId_archived_idx" ON "PricebookCategory"("companyId", "archived");
CREATE INDEX "PricebookCategory_companyId_parentId_idx" ON "PricebookCategory"("companyId", "parentId");

CREATE TABLE "PricebookItem" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "internalName" TEXT,
    "sku" TEXT,
    "type" "PricebookItemType" NOT NULL DEFAULT 'SERVICE',
    "customerDescription" TEXT,
    "technicianNotes" TEXT,
    "standardPriceCents" INTEGER NOT NULL,
    "memberPriceCents" INTEGER,
    "internalCostCents" INTEGER,
    "taxable" BOOLEAN NOT NULL DEFAULT true,
    "unit" TEXT NOT NULL DEFAULT 'each',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "importMode" TEXT NOT NULL DEFAULT 'LIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PricebookItem_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "PricebookItem_companyId_active_idx" ON "PricebookItem"("companyId", "active");
CREATE INDEX "PricebookItem_companyId_categoryId_idx" ON "PricebookItem"("companyId", "categoryId");
CREATE INDEX "PricebookItem_companyId_name_idx" ON "PricebookItem"("companyId", "name");
CREATE INDEX "PricebookItem_companyId_sku_idx" ON "PricebookItem"("companyId", "sku");

CREATE TABLE "EstimateOption" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "estimateId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "EstimateOption_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "EstimateOption_companyId_estimateId_idx" ON "EstimateOption"("companyId", "estimateId");

CREATE TABLE "MembershipPlan" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "priceCents" INTEGER NOT NULL,
    "billingFrequency" TEXT NOT NULL DEFAULT 'ANNUAL',
    "includedVisits" INTEGER,
    "discountPercent" INTEGER NOT NULL DEFAULT 0,
    "priorityService" BOOLEAN NOT NULL DEFAULT false,
    "benefits" TEXT,
    "terms" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "MembershipPlan_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "MembershipPlan_companyId_active_idx" ON "MembershipPlan"("companyId", "active");

CREATE TABLE "CustomerMembership" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "propertyId" TEXT,
    "planId" TEXT NOT NULL,
    "soldById" TEXT,
    "sourceJobId" TEXT,
    "sourceEstimateId" TEXT,
    "sourceInvoiceId" TEXT,
    "status" "CustomerMembershipStatus" NOT NULL DEFAULT 'PENDING',
    "priceCents" INTEGER NOT NULL,
    "saleDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startDate" TIMESTAMP(3),
    "renewalDate" TIMESTAMP(3),
    "visitsUsed" INTEGER NOT NULL DEFAULT 0,
    "importMode" TEXT NOT NULL DEFAULT 'LIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CustomerMembership_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "CustomerMembership_companyId_status_idx" ON "CustomerMembership"("companyId", "status");
CREATE INDEX "CustomerMembership_companyId_customerId_idx" ON "CustomerMembership"("companyId", "customerId");
CREATE INDEX "CustomerMembership_companyId_soldById_idx" ON "CustomerMembership"("companyId", "soldById");

CREATE TABLE "CompensationRule" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "CompensationRuleType" NOT NULL,
    "trigger" "CompensationTrigger" NOT NULL,
    "amountCents" INTEGER,
    "percentBps" INTEGER,
    "minAmountCents" INTEGER,
    "jobType" TEXT,
    "pricebookItemId" TEXT,
    "membershipPlanId" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CompensationRule_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "CompensationRule_companyId_active_idx" ON "CompensationRule"("companyId", "active");
CREATE INDEX "CompensationRule_companyId_trigger_idx" ON "CompensationRule"("companyId", "trigger");

CREATE TABLE "CompensationRuleVersion" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "snapshot" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CompensationRuleVersion_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "CompensationRuleVersion_companyId_ruleId_idx" ON "CompensationRuleVersion"("companyId", "ruleId");

CREATE TABLE "CompensationEvent" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "ruleVersionId" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "jobId" TEXT,
    "customerId" TEXT,
    "amountCents" INTEGER NOT NULL,
    "calculationBasis" TEXT NOT NULL,
    "status" "CompensationStatus" NOT NULL DEFAULT 'PENDING',
    "earnedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approvedAt" TIMESTAMP(3),
    "paidAt" TIMESTAMP(3),
    "approvedById" TEXT,
    "notes" TEXT,
    "importMode" TEXT NOT NULL DEFAULT 'LIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CompensationEvent_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "CompensationEvent_companyId_ruleId_sourceType_sourceId_userId_key" ON "CompensationEvent"("companyId", "ruleId", "sourceType", "sourceId", "userId");
CREATE INDEX "CompensationEvent_companyId_userId_status_idx" ON "CompensationEvent"("companyId", "userId", "status");
CREATE INDEX "CompensationEvent_companyId_status_earnedAt_idx" ON "CompensationEvent"("companyId", "status", "earnedAt");

CREATE TABLE "PerformanceGoal" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "userId" TEXT,
    "metricKey" TEXT NOT NULL,
    "target" INTEGER NOT NULL,
    "period" TEXT NOT NULL DEFAULT 'WEEK',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PerformanceGoal_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "PerformanceGoal_companyId_metricKey_idx" ON "PerformanceGoal"("companyId", "metricKey");

-- Foreign keys
ALTER TABLE "Estimate" ADD CONSTRAINT "Estimate_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "EstimateLineItem" ADD CONSTRAINT "EstimateLineItem_optionId_fkey" FOREIGN KEY ("optionId") REFERENCES "EstimateOption"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "EstimateLineItem" ADD CONSTRAINT "EstimateLineItem_pricebookItemId_fkey" FOREIGN KEY ("pricebookItemId") REFERENCES "PricebookItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PricebookCategory" ADD CONSTRAINT "PricebookCategory_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PricebookCategory" ADD CONSTRAINT "PricebookCategory_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "PricebookCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PricebookItem" ADD CONSTRAINT "PricebookItem_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PricebookItem" ADD CONSTRAINT "PricebookItem_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "PricebookCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "EstimateOption" ADD CONSTRAINT "EstimateOption_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EstimateOption" ADD CONSTRAINT "EstimateOption_estimateId_fkey" FOREIGN KEY ("estimateId") REFERENCES "Estimate"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MembershipPlan" ADD CONSTRAINT "MembershipPlan_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CustomerMembership" ADD CONSTRAINT "CustomerMembership_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CustomerMembership" ADD CONSTRAINT "CustomerMembership_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CustomerMembership" ADD CONSTRAINT "CustomerMembership_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CustomerMembership" ADD CONSTRAINT "CustomerMembership_planId_fkey" FOREIGN KEY ("planId") REFERENCES "MembershipPlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CustomerMembership" ADD CONSTRAINT "CustomerMembership_soldById_fkey" FOREIGN KEY ("soldById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CustomerMembership" ADD CONSTRAINT "CustomerMembership_sourceJobId_fkey" FOREIGN KEY ("sourceJobId") REFERENCES "Job"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CustomerMembership" ADD CONSTRAINT "CustomerMembership_sourceEstimateId_fkey" FOREIGN KEY ("sourceEstimateId") REFERENCES "Estimate"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CustomerMembership" ADD CONSTRAINT "CustomerMembership_sourceInvoiceId_fkey" FOREIGN KEY ("sourceInvoiceId") REFERENCES "Invoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CompensationRule" ADD CONSTRAINT "CompensationRule_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CompensationRuleVersion" ADD CONSTRAINT "CompensationRuleVersion_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CompensationRuleVersion" ADD CONSTRAINT "CompensationRuleVersion_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "CompensationRule"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CompensationEvent" ADD CONSTRAINT "CompensationEvent_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CompensationEvent" ADD CONSTRAINT "CompensationEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CompensationEvent" ADD CONSTRAINT "CompensationEvent_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "CompensationRule"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CompensationEvent" ADD CONSTRAINT "CompensationEvent_ruleVersionId_fkey" FOREIGN KEY ("ruleVersionId") REFERENCES "CompensationRuleVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CompensationEvent" ADD CONSTRAINT "CompensationEvent_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CompensationEvent" ADD CONSTRAINT "CompensationEvent_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CompensationEvent" ADD CONSTRAINT "CompensationEvent_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PerformanceGoal" ADD CONSTRAINT "PerformanceGoal_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PerformanceGoal" ADD CONSTRAINT "PerformanceGoal_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
