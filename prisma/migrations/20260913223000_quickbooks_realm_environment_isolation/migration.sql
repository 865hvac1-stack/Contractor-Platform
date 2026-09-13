-- QuickBooks ownership must be explicit. Existing rows are not assigned to the
-- currently connected realm unless their own persisted metadata contains both
-- an authoritative realm and environment.
ALTER TABLE "IntegrationConnection"
  ADD COLUMN "environment" TEXT;

ALTER TABLE "QuickBooksSettings"
  ADD COLUMN "syncEnvironment" TEXT,
  ADD COLUMN "syncRealmId" TEXT,
  ADD COLUMN "syncActivatedAt" TIMESTAMP(3);

ALTER TABLE "QuickBooksMapping"
  ADD COLUMN "environment" TEXT,
  ADD COLUMN "realmId" TEXT,
  ADD COLUMN "ownershipStatus" TEXT NOT NULL DEFAULT 'LEGACY_UNSCOPED';

ALTER TABLE "QuickBooksSyncEvent"
  ADD COLUMN "environment" TEXT,
  ADD COLUMN "realmId" TEXT,
  ADD COLUMN "ownershipStatus" TEXT NOT NULL DEFAULT 'LEGACY_UNSCOPED';

-- The connection environment is authoritative because it is the environment
-- selected for the OAuth app used to create the current connection.
UPDATE "IntegrationConnection" AS connection
SET "environment" = LOWER(settings."appEnvironment")
FROM "QuickBooksSettings" AS settings
WHERE connection."companyId" = settings."companyId"
  AND connection."providerKey" = 'quickbooks_online'
  AND LOWER(settings."appEnvironment") IN ('sandbox', 'production');

-- Historical import code persisted both values in mapping metadata. Those are
-- the only legacy mappings that can be backfilled without guessing.
UPDATE "QuickBooksMapping"
SET
  "environment" = LOWER("metadata"->>'environment'),
  "realmId" = NULLIF(BTRIM("metadata"->>'realmId'), ''),
  "ownershipStatus" = 'SCOPED'
WHERE LOWER("metadata"->>'environment') IN ('sandbox', 'production')
  AND NULLIF(BTRIM("metadata"->>'realmId'), '') IS NOT NULL;

ALTER TABLE "QuickBooksMapping"
  DROP CONSTRAINT "QuickBooksMapping_companyId_entityType_internalId_key";

CREATE UNIQUE INDEX "QuickBooksMapping_companyId_environment_realmId_entityType_internalId_key"
  ON "QuickBooksMapping"("companyId", "environment", "realmId", "entityType", "internalId");
CREATE INDEX "QuickBooksMapping_companyId_entityType_internalId_idx"
  ON "QuickBooksMapping"("companyId", "entityType", "internalId");
CREATE INDEX "QuickBooksMapping_companyId_environment_realmId_entityType_quickbooksId_idx"
  ON "QuickBooksMapping"("companyId", "environment", "realmId", "entityType", "quickbooksId");
CREATE INDEX "QuickBooksMapping_companyId_ownershipStatus_idx"
  ON "QuickBooksMapping"("companyId", "ownershipStatus");

DROP INDEX "QuickBooksMapping_companyId_entityType_quickbooksId_idx";
DROP INDEX "QuickBooksSyncEvent_companyId_createdAt_idx";
DROP INDEX "QuickBooksSyncEvent_companyId_entityType_internalId_idx";

CREATE INDEX "QuickBooksSyncEvent_companyId_environment_realmId_createdAt_idx"
  ON "QuickBooksSyncEvent"("companyId", "environment", "realmId", "createdAt");
CREATE INDEX "QuickBooksSyncEvent_companyId_environment_realmId_entityType_internalId_idx"
  ON "QuickBooksSyncEvent"("companyId", "environment", "realmId", "entityType", "internalId");
CREATE INDEX "QuickBooksSyncEvent_companyId_ownershipStatus_idx"
  ON "QuickBooksSyncEvent"("companyId", "ownershipStatus");
