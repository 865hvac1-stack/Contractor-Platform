-- Explicit integration-sandbox flag and TEST_ONLY provider grants.
-- Does not change IntegrationConnection uniqueness or 865 HVAC ownership.

ALTER TABLE "Company" ADD COLUMN IF NOT EXISTS "allowExternalIntegrationTesting" BOOLEAN NOT NULL DEFAULT false;

UPDATE "Company"
SET "allowExternalIntegrationTesting" = true
WHERE "isDemo" = true
  AND "businessName" = 'Summit Home Services';

CREATE TABLE IF NOT EXISTS "ProviderTestGrant" (
    "id" TEXT NOT NULL,
    "tenantCompanyId" TEXT NOT NULL,
    "ownerCompanyId" TEXT NOT NULL,
    "providerKey" TEXT NOT NULL,
    "ownerLocationId" TEXT NOT NULL,
    "mode" TEXT NOT NULL DEFAULT 'TEST_ONLY',
    "status" TEXT NOT NULL DEFAULT 'AUTHORIZED',
    "accountLabel" TEXT,
    "scopes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ProviderTestGrant_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ProviderTestGrant_tenantCompanyId_providerKey_key"
  ON "ProviderTestGrant"("tenantCompanyId", "providerKey");

CREATE INDEX IF NOT EXISTS "ProviderTestGrant_ownerCompanyId_providerKey_ownerLocationId_idx"
  ON "ProviderTestGrant"("ownerCompanyId", "providerKey", "ownerLocationId");

ALTER TABLE "ProviderTestGrant"
  ADD CONSTRAINT "ProviderTestGrant_tenantCompanyId_fkey"
  FOREIGN KEY ("tenantCompanyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ProviderTestGrant"
  ADD CONSTRAINT "ProviderTestGrant_ownerCompanyId_fkey"
  FOREIGN KEY ("ownerCompanyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
