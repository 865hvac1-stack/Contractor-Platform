-- AlterEnum
ALTER TYPE "Industry" ADD VALUE IF NOT EXISTS 'PAINTING';
ALTER TYPE "Industry" ADD VALUE IF NOT EXISTS 'FLOORING';
ALTER TYPE "Industry" ADD VALUE IF NOT EXISTS 'CLEANING';
ALTER TYPE "Industry" ADD VALUE IF NOT EXISTS 'PEST_CONTROL';

-- AlterTable
ALTER TABLE "NumberSequence" ADD COLUMN IF NOT EXISTS "padding" INTEGER NOT NULL DEFAULT 5;

-- CreateTable
CREATE TABLE IF NOT EXISTS "ServiceType" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "description" TEXT,
    "playbookKey" TEXT,
    "playbookId" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "archivedAt" TIMESTAMP(3),
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ServiceType_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "Job" ADD COLUMN IF NOT EXISTS "serviceTypeId" TEXT;
ALTER TABLE "Invoice" ADD COLUMN IF NOT EXISTS "serviceTypeId" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "ServiceType_companyId_key_key" ON "ServiceType"("companyId", "key");
CREATE INDEX IF NOT EXISTS "ServiceType_companyId_active_sortOrder_idx" ON "ServiceType"("companyId", "active", "sortOrder");
CREATE INDEX IF NOT EXISTS "ServiceType_companyId_playbookId_idx" ON "ServiceType"("companyId", "playbookId");
CREATE INDEX IF NOT EXISTS "Job_companyId_serviceTypeId_idx" ON "Job"("companyId", "serviceTypeId");
CREATE INDEX IF NOT EXISTS "Invoice_companyId_serviceTypeId_idx" ON "Invoice"("companyId", "serviceTypeId");

ALTER TABLE "ServiceType" ADD CONSTRAINT "ServiceType_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ServiceType" ADD CONSTRAINT "ServiceType_playbookId_fkey" FOREIGN KEY ("playbookId") REFERENCES "Playbook"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Job" ADD CONSTRAINT "Job_serviceTypeId_fkey" FOREIGN KEY ("serviceTypeId") REFERENCES "ServiceType"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_serviceTypeId_fkey" FOREIGN KEY ("serviceTypeId") REFERENCES "ServiceType"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Initialize invoice sequences from existing INV-##### numbers without changing invoices.
WITH parsed AS (
  SELECT
    i."companyId",
    MAX(CAST(substring(i."invoiceNumber" FROM '([0-9]+)$') AS INTEGER)) AS max_n
  FROM "Invoice" i
  WHERE i."invoiceNumber" ~ '^INV-[0-9]+$'
  GROUP BY i."companyId"
)
INSERT INTO "NumberSequence" ("id", "companyId", "kind", "prefix", "nextValue", "padding")
SELECT
  ('c' || substr(md5(random()::text || p."companyId"), 1, 24)),
  p."companyId",
  'INVOICE',
  'INV',
  p.max_n + 1,
  5
FROM parsed p
ON CONFLICT ("companyId", "kind") DO UPDATE
SET "nextValue" = GREATEST("NumberSequence"."nextValue", EXCLUDED."nextValue");

WITH parsed AS (
  SELECT
    j."companyId",
    MAX(CAST(substring(j."jobNumber" FROM '([0-9]+)$') AS INTEGER)) AS max_n
  FROM "Job" j
  WHERE j."jobNumber" ~ '^JOB-[0-9]+$'
  GROUP BY j."companyId"
)
INSERT INTO "NumberSequence" ("id", "companyId", "kind", "prefix", "nextValue", "padding")
SELECT
  ('c' || substr(md5(random()::text || p."companyId" || 'job'), 1, 24)),
  p."companyId",
  'JOB',
  'JOB',
  p.max_n + 1,
  5
FROM parsed p
ON CONFLICT ("companyId", "kind") DO UPDATE
SET "nextValue" = GREATEST("NumberSequence"."nextValue", EXCLUDED."nextValue");

WITH parsed AS (
  SELECT
    e."companyId",
    MAX(CAST(substring(e."estimateNumber" FROM '([0-9]+)$') AS INTEGER)) AS max_n
  FROM "Estimate" e
  WHERE e."estimateNumber" ~ '^EST-[0-9]+$'
  GROUP BY e."companyId"
)
INSERT INTO "NumberSequence" ("id", "companyId", "kind", "prefix", "nextValue", "padding")
SELECT
  ('c' || substr(md5(random()::text || p."companyId" || 'est'), 1, 24)),
  p."companyId",
  'ESTIMATE',
  'EST',
  p.max_n + 1,
  5
FROM parsed p
ON CONFLICT ("companyId", "kind") DO UPDATE
SET "nextValue" = GREATEST("NumberSequence"."nextValue", EXCLUDED."nextValue");
