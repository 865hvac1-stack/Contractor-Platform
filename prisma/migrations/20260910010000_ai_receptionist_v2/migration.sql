-- AlterTable
ALTER TABLE "CompanyAiReceptionistSetting" ADD COLUMN "mode" TEXT NOT NULL DEFAULT 'HIGHLEVEL_REGINA';
ALTER TABLE "CompanyAiReceptionistSetting" ADD COLUMN "tone" TEXT NOT NULL DEFAULT 'warm';
ALTER TABLE "CompanyAiReceptionistSetting" ADD COLUMN "responseLength" TEXT NOT NULL DEFAULT 'short';
ALTER TABLE "CompanyAiReceptionistSetting" ADD COLUMN "companyDescription" TEXT;
ALTER TABLE "CompanyAiReceptionistSetting" ADD COLUMN "businessHoursText" TEXT;
ALTER TABLE "CompanyAiReceptionistSetting" ADD COLUMN "afterHoursBehavior" TEXT NOT NULL DEFAULT 'OFFER_CALLBACK';
ALTER TABLE "CompanyAiReceptionistSetting" ADD COLUMN "serviceAreaNote" TEXT;
ALTER TABLE "CompanyAiReceptionistSetting" ADD COLUMN "servicesOffered" TEXT;
ALTER TABLE "CompanyAiReceptionistSetting" ADD COLUMN "emergencyGuidance" TEXT;
ALTER TABLE "CompanyAiReceptionistSetting" ADD COLUMN "handoffRules" TEXT;
ALTER TABLE "CompanyAiReceptionistSetting" ADD COLUMN "useCustomerFirstName" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "CompanyAiReceptionistSetting" ADD COLUMN "allowScheduling" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "CompanyAiReceptionistSetting" ADD COLUMN "allowRescheduling" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "CompanyAiReceptionistSetting" ADD COLUMN "allowCancellations" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "CompanyAiReceptionistSetting" ADD COLUMN "allowJobStatus" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "CompanyAiReceptionistSetting" ADD COLUMN "allowInvoiceQuestions" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "CompanyAiReceptionistSetting" ADD COLUMN "allowEstimateQuestions" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "CompanyAiReceptionistSetting" ADD COLUMN "allowMembershipQuestions" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "CompanyAiReceptionistSetting" ADD COLUMN "allowWaitingQuestions" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "CompanyAiReceptionistSetting" ADD COLUMN "knowledgeJson" JSONB;

-- AlterTable
ALTER TABLE "ReceptionistTurn" ADD COLUMN "mode" TEXT;
ALTER TABLE "ReceptionistTurn" ADD COLUMN "proposedResponse" TEXT;
ALTER TABLE "ReceptionistTurn" ADD COLUMN "actualResponse" TEXT;
ALTER TABLE "ReceptionistTurn" ADD COLUMN "confidence" DOUBLE PRECISION;
ALTER TABLE "ReceptionistTurn" ADD COLUMN "requestedAction" TEXT;
ALTER TABLE "ReceptionistTurn" ADD COLUMN "extractedFields" JSONB;
ALTER TABLE "ReceptionistTurn" ADD COLUMN "verifiedFacts" JSONB;
ALTER TABLE "ReceptionistTurn" ADD COLUMN "provider" TEXT;
ALTER TABLE "ReceptionistTurn" ADD COLUMN "model" TEXT;
ALTER TABLE "ReceptionistTurn" ADD COLUMN "inputTokens" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "ReceptionistTurn" ADD COLUMN "outputTokens" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "ReceptionistTurn" ADD COLUMN "costMicrousd" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "ReceptionistTurn" ADD COLUMN "shadow" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "ReceptionistTurn" ADD COLUMN "toolUsed" TEXT;
ALTER TABLE "ReceptionistTurn" ADD COLUMN "activeWorkflow" TEXT;

CREATE INDEX "ReceptionistTurn_companyId_shadow_createdAt_idx" ON "ReceptionistTurn"("companyId", "shadow", "createdAt");
