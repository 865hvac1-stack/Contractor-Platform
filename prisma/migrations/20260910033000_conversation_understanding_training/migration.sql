-- Company-scoped conversation understanding starters. Does not change ownership or mode.
-- HVAC-specific wording is limited to production 865 HVAC. The capability itself is generic.

INSERT INTO "ReceptionistConversationRule" ("id", "companyId", "body", "active", "priority", "createdAt", "updatedAt")
SELECT concat('rcr_svc_', "id"), "id",
  'When a customer describes an actual HVAC problem that likely requires service and they do not already have an appointment, naturally offer to schedule a service visit.',
  true, 5, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "Company"
WHERE "businessName" = '865 HVAC' AND "isDemo" = false
AND NOT EXISTS (
  SELECT 1 FROM "ReceptionistConversationRule" r
  WHERE r."companyId" = "Company"."id"
    AND r."body" LIKE 'When a customer describes an actual HVAC problem%'
);

INSERT INTO "ReceptionistConversationRule" ("id", "companyId", "body", "active", "priority", "createdAt", "updatedAt")
SELECT concat('rcr_subj_', "id"), "id",
  'Keep the current conversation subject. Do not invent objects or appliances the customer did not mention.',
  true, 6, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "Company"
WHERE "businessName" = '865 HVAC' AND "isDemo" = false
AND NOT EXISTS (
  SELECT 1 FROM "ReceptionistConversationRule" r
  WHERE r."companyId" = "Company"."id"
    AND r."body" LIKE 'Keep the current conversation subject%'
);

INSERT INTO "ReceptionistConversationRule" ("id", "companyId", "body", "active", "priority", "createdAt", "updatedAt")
SELECT concat('rcr_short_', "id"), "id",
  'Short replies such as yes, it, that, and okay refer to the outstanding question or current service concern.',
  true, 7, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "Company"
WHERE "businessName" = '865 HVAC' AND "isDemo" = false
AND NOT EXISTS (
  SELECT 1 FROM "ReceptionistConversationRule" r
  WHERE r."companyId" = "Company"."id"
    AND r."body" LIKE 'Short replies such as yes, it, that%'
);

INSERT INTO "ReceptionistOpportunityRule" (
  "id", "companyId", "type", "title", "triggerText", "verifiedRequirement", "suggestedBehavior", "cta", "active", "priority", "createdAt", "updatedAt"
)
SELECT
  concat('ror_svc_', "id"),
  "id",
  'SERVICE_CONCERN',
  'Service visit',
  'Customer describes an actual HVAC problem that likely needs a technician',
  'No verified upcoming appointment and no active scheduling session',
  'Acknowledge the problem safely. Do not invent troubleshooting. If they do not already have an appointment, offer a service visit. Do not start scheduling until they accept.',
  'That''s something we can take a look at. Want me to check our openings?',
  true,
  5,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "Company"
WHERE "businessName" = '865 HVAC' AND "isDemo" = false
AND NOT EXISTS (
  SELECT 1 FROM "ReceptionistOpportunityRule" r WHERE r."companyId" = "Company"."id" AND r."type" = 'SERVICE_CONCERN'
);

INSERT INTO "ReceptionistApprovedExample" (
  "id", "companyId", "customerMessage", "preferredResponse", "intent", "active", "createdAt", "updatedAt"
)
SELECT
  concat('rae_run_', "id"),
  "id",
  'My AC has been running nonstop.',
  'Got it. That''s something we can take a look at. Want me to check our openings?',
  'SERVICE_CONCERN',
  true,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "Company"
WHERE "businessName" = '865 HVAC' AND "isDemo" = false
AND NOT EXISTS (
  SELECT 1 FROM "ReceptionistApprovedExample" e
  WHERE e."companyId" = "Company"."id"
    AND e."customerMessage" = 'My AC has been running nonstop.'
);
