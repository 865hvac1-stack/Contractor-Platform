-- 865 HVAC: HighLevel Regina owns customer-facing conversation.
-- ContractorYou remains the scheduling/booking source of truth.
UPDATE "Company"
SET "customerConversationOwner" = 'HIGHLEVEL_AI'
WHERE "businessName" = '865 HVAC' AND "isDemo" = false;
