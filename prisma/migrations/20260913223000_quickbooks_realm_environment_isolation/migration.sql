-- QuickBooks ownership must be explicit. Existing rows are not assigned to the
-- currently connected realm unless their own persisted metadata contains both
-- an authoritative realm and environment.
ALTER TABLE "IntegrationConnection"
  ADD COLUMN IF NOT EXISTS "environment" TEXT;

ALTER TABLE "QuickBooksSettings"
  ADD COLUMN IF NOT EXISTS "syncEnvironment" TEXT,
  ADD COLUMN IF NOT EXISTS "syncRealmId" TEXT,
  ADD COLUMN IF NOT EXISTS "syncActivatedAt" TIMESTAMP(3);

ALTER TABLE "QuickBooksMapping"
  ADD COLUMN IF NOT EXISTS "environment" TEXT,
  ADD COLUMN IF NOT EXISTS "realmId" TEXT,
  ADD COLUMN IF NOT EXISTS "ownershipStatus" TEXT NOT NULL DEFAULT 'LEGACY_UNSCOPED';

ALTER TABLE "QuickBooksSyncEvent"
  ADD COLUMN IF NOT EXISTS "environment" TEXT,
  ADD COLUMN IF NOT EXISTS "realmId" TEXT,
  ADD COLUMN IF NOT EXISTS "ownershipStatus" TEXT NOT NULL DEFAULT 'LEGACY_UNSCOPED';

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

-- Prisma created this object with CREATE UNIQUE INDEX in the original
-- QuickBooks migration. It is an index, not a table constraint.
DROP INDEX IF EXISTS "QuickBooksMapping_companyId_entityType_internalId_key";

CREATE UNIQUE INDEX IF NOT EXISTS "QuickBooksMapping_companyId_environment_realmId_entityType_internalId_key"
  ON "QuickBooksMapping"("companyId", "environment", "realmId", "entityType", "internalId");
CREATE INDEX IF NOT EXISTS "QuickBooksMapping_companyId_entityType_internalId_idx"
  ON "QuickBooksMapping"("companyId", "entityType", "internalId");
CREATE INDEX IF NOT EXISTS "QuickBooksMapping_companyId_environment_realmId_entityType_quickbooksId_idx"
  ON "QuickBooksMapping"("companyId", "environment", "realmId", "entityType", "quickbooksId");
CREATE INDEX IF NOT EXISTS "QuickBooksMapping_companyId_ownershipStatus_idx"
  ON "QuickBooksMapping"("companyId", "ownershipStatus");

DROP INDEX IF EXISTS "QuickBooksMapping_companyId_entityType_quickbooksId_idx";
DROP INDEX IF EXISTS "QuickBooksSyncEvent_companyId_createdAt_idx";
DROP INDEX IF EXISTS "QuickBooksSyncEvent_companyId_entityType_internalId_idx";

CREATE INDEX IF NOT EXISTS "QuickBooksSyncEvent_companyId_environment_realmId_createdAt_idx"
  ON "QuickBooksSyncEvent"("companyId", "environment", "realmId", "createdAt");
CREATE INDEX IF NOT EXISTS "QuickBooksSyncEvent_companyId_environment_realmId_entityType_internalId_idx"
  ON "QuickBooksSyncEvent"("companyId", "environment", "realmId", "entityType", "internalId");
CREATE INDEX IF NOT EXISTS "QuickBooksSyncEvent_companyId_ownershipStatus_idx"
  ON "QuickBooksSyncEvent"("companyId", "ownershipStatus");
