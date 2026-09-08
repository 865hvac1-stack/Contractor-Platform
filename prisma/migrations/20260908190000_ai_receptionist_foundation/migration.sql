-- ContractorYou AI receptionist settings, turn diagnostics, and 865 HVAC ownership flip.
-- HighLevel remains SMS transport. ContractorYou owns conversation intelligence.

CREATE TABLE "CompanyAiReceptionistSetting" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "assistantName" TEXT NOT NULL DEFAULT 'Regina',
    "autoReplyInboundSms" BOOLEAN NOT NULL DEFAULT true,
    "autoBookServiceCalls" BOOLEAN NOT NULL DEFAULT true,
    "allowSameDayBooking" BOOLEAN NOT NULL DEFAULT true,
    "humanHandoffFallback" BOOLEAN NOT NULL DEFAULT true,
    "businessHoursBehavior" TEXT NOT NULL DEFAULT 'ALWAYS',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CompanyAiReceptionistSetting_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CompanyAiReceptionistSetting_companyId_key" ON "CompanyAiReceptionistSetting"("companyId");

ALTER TABLE "CompanyAiReceptionistSetting" ADD CONSTRAINT "CompanyAiReceptionistSetting_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "ReceptionistTurn" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "inboundMessageId" TEXT NOT NULL,
    "customerId" TEXT,
    "propertyId" TEXT,
    "intent" TEXT NOT NULL,
    "schedulingState" TEXT,
    "availabilityCount" INTEGER NOT NULL DEFAULT 0,
    "bookingResult" TEXT,
    "outboundSent" BOOLEAN NOT NULL DEFAULT false,
    "handoffReason" TEXT,
    "errorCode" TEXT,
    "durationMs" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReceptionistTurn_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ReceptionistTurn_companyId_inboundMessageId_key" ON "ReceptionistTurn"("companyId", "inboundMessageId");
CREATE INDEX "ReceptionistTurn_companyId_threadId_createdAt_idx" ON "ReceptionistTurn"("companyId", "threadId", "createdAt");
CREATE INDEX "ReceptionistTurn_companyId_createdAt_idx" ON "ReceptionistTurn"("companyId", "createdAt");

ALTER TABLE "ReceptionistTurn" ADD CONSTRAINT "ReceptionistTurn_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ConversationSchedulingState" ADD COLUMN "lastIntent" TEXT;
ALTER TABLE "ConversationSchedulingState" ADD COLUMN "lastAiAction" TEXT;
ALTER TABLE "ConversationSchedulingState" ADD COLUMN "handoffReason" TEXT;
ALTER TABLE "ConversationSchedulingState" ADD COLUMN "receptionistTurnCount" INTEGER NOT NULL DEFAULT 0;

-- 865 HVAC: ContractorYou Regina owns the customer conversation. Disable HighLevel Conversation AI in GHL.
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
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "Company"
WHERE "businessName" = '865 HVAC' AND "isDemo" = false
ON CONFLICT ("companyId") DO UPDATE SET
  "enabled" = true,
  "assistantName" = 'Regina',
  "autoReplyInboundSms" = true,
  "updatedAt" = CURRENT_TIMESTAMP;
