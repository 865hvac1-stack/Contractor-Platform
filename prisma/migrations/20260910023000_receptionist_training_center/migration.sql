-- AI Receptionist Training Center. Tenant-scoped. Does not change 865 HVAC live ownership.

ALTER TABLE "ReceptionistTurn" ADD COLUMN IF NOT EXISTS "reviewStatus" TEXT;
ALTER TABLE "ReceptionistTurn" ADD COLUMN IF NOT EXISTS "trainingSources" JSONB;

CREATE TABLE "ReceptionistKnowledgeItem" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "answer" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'FAQ',
    "notes" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ReceptionistKnowledgeItem_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ReceptionistConversationRule" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "priority" INTEGER NOT NULL DEFAULT 100,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ReceptionistConversationRule_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ReceptionistOpportunityRule" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "triggerText" TEXT NOT NULL,
    "verifiedRequirement" TEXT NOT NULL,
    "suggestedBehavior" TEXT NOT NULL,
    "cta" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "priority" INTEGER NOT NULL DEFAULT 100,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ReceptionistOpportunityRule_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ReceptionistApprovedExample" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "customerMessage" TEXT NOT NULL,
    "preferredResponse" TEXT NOT NULL,
    "intent" TEXT NOT NULL DEFAULT 'GENERAL_QUESTION',
    "notes" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ReceptionistApprovedExample_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ReceptionistTrainingReview" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "turnId" TEXT NOT NULL,
    "decision" TEXT NOT NULL,
    "improvedText" TEXT,
    "savedAs" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ReceptionistTrainingReview_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ReceptionistOpportunityEvent" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ReceptionistOpportunityEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ReceptionistKnowledgeItem_companyId_active_category_idx" ON "ReceptionistKnowledgeItem"("companyId", "active", "category");
CREATE INDEX "ReceptionistConversationRule_companyId_active_priority_idx" ON "ReceptionistConversationRule"("companyId", "active", "priority");
CREATE INDEX "ReceptionistOpportunityRule_companyId_active_type_idx" ON "ReceptionistOpportunityRule"("companyId", "active", "type");
CREATE INDEX "ReceptionistApprovedExample_companyId_active_intent_idx" ON "ReceptionistApprovedExample"("companyId", "active", "intent");
CREATE INDEX "ReceptionistTrainingReview_companyId_createdAt_idx" ON "ReceptionistTrainingReview"("companyId", "createdAt");
CREATE INDEX "ReceptionistTrainingReview_turnId_idx" ON "ReceptionistTrainingReview"("turnId");
CREATE INDEX "ReceptionistOpportunityEvent_companyId_threadId_createdAt_idx" ON "ReceptionistOpportunityEvent"("companyId", "threadId", "createdAt");

ALTER TABLE "ReceptionistKnowledgeItem" ADD CONSTRAINT "ReceptionistKnowledgeItem_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ReceptionistConversationRule" ADD CONSTRAINT "ReceptionistConversationRule_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ReceptionistOpportunityRule" ADD CONSTRAINT "ReceptionistOpportunityRule_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ReceptionistApprovedExample" ADD CONSTRAINT "ReceptionistApprovedExample_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ReceptionistTrainingReview" ADD CONSTRAINT "ReceptionistTrainingReview_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ReceptionistTrainingReview" ADD CONSTRAINT "ReceptionistTrainingReview_turnId_fkey" FOREIGN KEY ("turnId") REFERENCES "ReceptionistTurn"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ReceptionistOpportunityEvent" ADD CONSTRAINT "ReceptionistOpportunityEvent_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ReceptionistOpportunityEvent" ADD CONSTRAINT "ReceptionistOpportunityEvent_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "ReceptionistOpportunityRule"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Safe 865 HVAC starters only. No invented prices, benefits, or terms. Ownership/mode unchanged.
INSERT INTO "ReceptionistConversationRule" ("id", "companyId", "body", "active", "priority", "createdAt", "updatedAt")
SELECT concat('rcr_', "id", '_', gs.n), "id", gs.body, true, gs.n * 10, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "Company"
CROSS JOIN (
  SELECT 1 AS n, 'Greet once, not every message.' AS body
  UNION ALL SELECT 2, 'Do not start every response with the customer''s name.'
  UNION ALL SELECT 3, 'Use the customer''s first name naturally and occasionally.'
  UNION ALL SELECT 4, 'Keep SMS replies concise.'
  UNION ALL SELECT 5, 'Sound like a great local office person, not a chatbot.'
  UNION ALL SELECT 6, 'Do not restart an active conversation.'
  UNION ALL SELECT 7, 'Do not repeatedly say "How can I assist you today?"'
  UNION ALL SELECT 8, 'Answer casual conversation naturally.'
  UNION ALL SELECT 9, 'If the customer says thanks, ok, sounds good, or awesome, acknowledge it and stay on the active workflow.'
  UNION ALL SELECT 10, 'If the customer asks a side question during a workflow, answer it and then return to the outstanding task.'
  UNION ALL SELECT 11, 'Never diagnose HVAC problems.'
  UNION ALL SELECT 12, 'Never invent pricing, benefits, discounts, or plan terms.'
  UNION ALL SELECT 13, 'Never invent availability.'
  UNION ALL SELECT 14, 'Never claim an action succeeded without verified ContractorYou success.'
  UNION ALL SELECT 15, 'Never say a customer is booked, canceled, rescheduled, paid, enrolled, or updated unless ContractorYou verifies it.'
) gs
WHERE "businessName" = '865 HVAC' AND "isDemo" = false
AND NOT EXISTS (
  SELECT 1 FROM "ReceptionistConversationRule" r WHERE r."companyId" = "Company"."id"
);

INSERT INTO "ReceptionistOpportunityRule" (
  "id", "companyId", "type", "title", "triggerText", "verifiedRequirement", "suggestedBehavior", "cta", "active", "priority", "createdAt", "updatedAt"
)
SELECT
  concat('ror_maint_', "id"),
  "id",
  'MAINTENANCE',
  'Maintenance plan',
  'Customer asks about maintenance or membership',
  'Verified ContractorYou membership status is none or inactive',
  'Answer the verified status clearly, then offer plan information naturally. Do not invent price, benefits, or terms. Do not enroll them.',
  'We do offer one though — want me to send you the details?',
  true,
  10,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "Company"
WHERE "businessName" = '865 HVAC' AND "isDemo" = false
AND NOT EXISTS (
  SELECT 1 FROM "ReceptionistOpportunityRule" r WHERE r."companyId" = "Company"."id" AND r."type" = 'MAINTENANCE'
);
