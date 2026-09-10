-- Controlled live test: 865 HVAC only. Demo tenants are not changed.
-- HighLevel remains SMS transport. Regina's HighLevel config is not deleted.

UPDATE "Company"
SET "customerConversationOwner" = 'CONTRACTORYOU'
WHERE "businessName" = '865 HVAC' AND "isDemo" = false;

INSERT INTO "CompanyAiReceptionistSetting" (
  "id",
  "companyId",
  "enabled",
  "assistantName",
  "autoReplyInboundSms",
  "autoBookServiceCalls",
  "allowSameDayBooking",
  "humanHandoffFallback",
  "businessHoursBehavior",
  "mode",
  "createdAt",
  "updatedAt"
)
SELECT
  concat('recv_', "id"),
  "id",
  true,
  'Regina',
  true,
  true,
  true,
  true,
  'ALWAYS',
  'CONTRACTORYOU_AI',
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "Company"
WHERE "businessName" = '865 HVAC' AND "isDemo" = false
ON CONFLICT ("companyId") DO UPDATE SET
  "mode" = 'CONTRACTORYOU_AI',
  "enabled" = true,
  "autoReplyInboundSms" = true,
  "updatedAt" = CURRENT_TIMESTAMP;
