-- Additive Customer 360 property facts, notes, and photo soft-delete.
-- Production-safe: no drops, no data rewrite.

ALTER TABLE "Property" ADD COLUMN IF NOT EXISTS "yearBuilt" INTEGER;
ALTER TABLE "Property" ADD COLUMN IF NOT EXISTS "squareFeet" INTEGER;
ALTER TABLE "Property" ADD COLUMN IF NOT EXISTS "bedrooms" INTEGER;
ALTER TABLE "Property" ADD COLUMN IF NOT EXISTS "bathrooms" DOUBLE PRECISION;
ALTER TABLE "Property" ADD COLUMN IF NOT EXISTS "lotSizeSqFt" INTEGER;
ALTER TABLE "Property" ADD COLUMN IF NOT EXISTS "lastSaleDate" TIMESTAMP(3);
ALTER TABLE "Property" ADD COLUMN IF NOT EXISTS "lastSalePriceCents" INTEGER;
ALTER TABLE "Property" ADD COLUMN IF NOT EXISTS "assessedValueCents" INTEGER;
ALTER TABLE "Property" ADD COLUMN IF NOT EXISTS "latitude" DOUBLE PRECISION;
ALTER TABLE "Property" ADD COLUMN IF NOT EXISTS "longitude" DOUBLE PRECISION;
ALTER TABLE "Property" ADD COLUMN IF NOT EXISTS "photoPath" TEXT;
ALTER TABLE "Property" ADD COLUMN IF NOT EXISTS "photoSource" TEXT;
ALTER TABLE "Property" ADD COLUMN IF NOT EXISTS "photoCaption" TEXT;
ALTER TABLE "Property" ADD COLUMN IF NOT EXISTS "propertyClass" TEXT;
ALTER TABLE "Property" ADD COLUMN IF NOT EXISTS "tags" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "Property" ADD COLUMN IF NOT EXISTS "enrichmentProvider" TEXT;
ALTER TABLE "Property" ADD COLUMN IF NOT EXISTS "enrichmentRetrievedAt" TIMESTAMP(3);
ALTER TABLE "Property" ADD COLUMN IF NOT EXISTS "enrichmentExternalId" TEXT;
ALTER TABLE "Property" ADD COLUMN IF NOT EXISTS "enrichmentStatus" TEXT DEFAULT 'NONE';
ALTER TABLE "Property" ADD COLUMN IF NOT EXISTS "factProvenance" JSONB;

CREATE INDEX IF NOT EXISTS "Property_companyId_zip_idx" ON "Property"("companyId", "zip");

ALTER TABLE "JobPhoto" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);
CREATE INDEX IF NOT EXISTS "JobPhoto_companyId_kind_createdAt_idx" ON "JobPhoto"("companyId", "kind", "createdAt");

CREATE INDEX IF NOT EXISTS "Equipment_companyId_serialNumber_idx" ON "Equipment"("companyId", "serialNumber");
CREATE INDEX IF NOT EXISTS "Equipment_companyId_model_idx" ON "Equipment"("companyId", "model");

CREATE TABLE IF NOT EXISTS "CustomerNote" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "propertyId" TEXT,
    "jobId" TEXT,
    "authorId" TEXT,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CustomerNote_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "CustomerNote_companyId_customerId_createdAt_idx" ON "CustomerNote"("companyId", "customerId", "createdAt");
CREATE INDEX IF NOT EXISTS "CustomerNote_companyId_propertyId_idx" ON "CustomerNote"("companyId", "propertyId");

ALTER TABLE "CustomerNote" ADD CONSTRAINT "CustomerNote_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CustomerNote" ADD CONSTRAINT "CustomerNote_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CustomerNote" ADD CONSTRAINT "CustomerNote_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CustomerNote" ADD CONSTRAINT "CustomerNote_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
