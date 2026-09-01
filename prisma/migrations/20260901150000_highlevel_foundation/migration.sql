-- Additive HighLevel identity + inbox tables. Existing records are untouched.

CREATE TABLE "ProviderIdentityMap" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "internalId" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProviderIdentityMap_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ProviderIdentityMap_companyId_provider_entityType_internalId_key"
  ON "ProviderIdentityMap"("companyId", "provider", "entityType", "internalId");
CREATE UNIQUE INDEX "ProviderIdentityMap_companyId_provider_entityType_externalId_key"
  ON "ProviderIdentityMap"("companyId", "provider", "entityType", "externalId");
CREATE INDEX "ProviderIdentityMap_companyId_provider_idx"
  ON "ProviderIdentityMap"("companyId", "provider");

ALTER TABLE "ProviderIdentityMap"
  ADD CONSTRAINT "ProviderIdentityMap_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "CommunicationThread" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "customerId" TEXT,
    "leadId" TEXT,
    "contactName" TEXT,
    "phone" TEXT,
    "lastPreview" TEXT,
    "lastActivityAt" TIMESTAMP(3) NOT NULL,
    "unread" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CommunicationThread_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CommunicationThread_companyId_provider_externalId_key"
  ON "CommunicationThread"("companyId", "provider", "externalId");
CREATE INDEX "CommunicationThread_companyId_lastActivityAt_idx"
  ON "CommunicationThread"("companyId", "lastActivityAt");
CREATE INDEX "CommunicationThread_companyId_unread_idx"
  ON "CommunicationThread"("companyId", "unread");

ALTER TABLE "CommunicationThread"
  ADD CONSTRAINT "CommunicationThread_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CommunicationThread"
  ADD CONSTRAINT "CommunicationThread_customerId_fkey"
  FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CommunicationThread"
  ADD CONSTRAINT "CommunicationThread_leadId_fkey"
  FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "CommunicationMessage" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "body" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "status" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CommunicationMessage_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CommunicationMessage_companyId_provider_externalId_key"
  ON "CommunicationMessage"("companyId", "provider", "externalId");
CREATE INDEX "CommunicationMessage_companyId_threadId_idx"
  ON "CommunicationMessage"("companyId", "threadId");
CREATE INDEX "CommunicationMessage_companyId_occurredAt_idx"
  ON "CommunicationMessage"("companyId", "occurredAt");

ALTER TABLE "CommunicationMessage"
  ADD CONSTRAINT "CommunicationMessage_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CommunicationMessage"
  ADD CONSTRAINT "CommunicationMessage_threadId_fkey"
  FOREIGN KEY ("threadId") REFERENCES "CommunicationThread"("id") ON DELETE CASCADE ON UPDATE CASCADE;
