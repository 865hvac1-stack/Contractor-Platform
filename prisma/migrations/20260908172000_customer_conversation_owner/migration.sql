-- Who may autonomously reply to inbound customer messages.
-- CONTRACTORYOU preserves existing behavior for unspecified tenants.
-- 865 HVAC is set to HIGHLEVEL_AI because Regina is the live conversation owner.
CREATE TYPE "CustomerConversationOwner" AS ENUM ('MANUAL', 'HIGHLEVEL_AI', 'CONTRACTORYOU');

ALTER TABLE "Company" ADD COLUMN "customerConversationOwner" "CustomerConversationOwner" NOT NULL DEFAULT 'CONTRACTORYOU';

UPDATE "Company"
SET "customerConversationOwner" = 'HIGHLEVEL_AI'
WHERE "businessName" = '865 HVAC' AND "isDemo" = false;

UPDATE "ConversationSchedulingState" AS state
SET
  "paused" = true,
  "status" = 'PAUSED'
FROM "Company" AS company
WHERE state."companyId" = company.id
  AND company."businessName" = '865 HVAC'
  AND company."isDemo" = false
  AND state."status" IN ('OPEN', 'CLARIFYING', 'SUGGESTED', 'NEEDS_REVIEW');
