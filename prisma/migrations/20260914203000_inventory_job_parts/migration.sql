-- Reuses PricebookItem as the part catalog. Inventory is additive and tenant scoped.
CREATE TYPE "InventoryLocationType" AS ENUM ('WAREHOUSE', 'TRUCK', 'OTHER');
CREATE TYPE "InventoryMovementType" AS ENUM ('RECEIVE', 'TRANSFER', 'RESERVE', 'RELEASE_RESERVATION', 'CONSUME', 'RETURN', 'ADJUSTMENT');
CREATE TYPE "JobPartStatus" AS ENUM ('NEEDED', 'RESERVED', 'PICKED_UP', 'INSTALLED', 'CANCELED');

CREATE TABLE "InventoryLocation" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "type" "InventoryLocationType" NOT NULL DEFAULT 'WAREHOUSE',
  "membershipId" TEXT,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "InventoryLocation_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "InventoryLocation_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "InventoryStock" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "partId" TEXT NOT NULL,
  "locationId" TEXT NOT NULL,
  "onHand" INTEGER NOT NULL DEFAULT 0,
  "reserved" INTEGER NOT NULL DEFAULT 0,
  "minimumStock" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "InventoryStock_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "InventoryStock_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "InventoryStock_partId_fkey" FOREIGN KEY ("partId") REFERENCES "PricebookItem"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "InventoryStock_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "InventoryLocation"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "InventoryStock_nonnegative_check" CHECK ("onHand" >= 0 AND "reserved" >= 0 AND "reserved" <= "onHand" AND "minimumStock" >= 0)
);

CREATE TABLE "JobPart" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "jobId" TEXT NOT NULL,
  "partId" TEXT NOT NULL,
  "locationId" TEXT,
  "quantity" INTEGER NOT NULL,
  "status" "JobPartStatus" NOT NULL DEFAULT 'NEEDED',
  "unitCostCents" INTEGER NOT NULL,
  "unitPriceCents" INTEGER,
  "notes" TEXT,
  "createdById" TEXT NOT NULL,
  "reservedAt" TIMESTAMP(3),
  "pickedUpAt" TIMESTAMP(3),
  "installedAt" TIMESTAMP(3),
  "canceledAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "JobPart_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "JobPart_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "JobPart_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "JobPart_partId_fkey" FOREIGN KEY ("partId") REFERENCES "PricebookItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "JobPart_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "InventoryLocation"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "JobPart_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "JobPart_quantity_check" CHECK ("quantity" > 0 AND "unitCostCents" >= 0)
);

CREATE TABLE "InventoryMovement" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "partId" TEXT NOT NULL,
  "quantity" INTEGER NOT NULL,
  "type" "InventoryMovementType" NOT NULL,
  "fromLocationId" TEXT,
  "toLocationId" TEXT,
  "jobId" TEXT,
  "jobPartId" TEXT,
  "actorId" TEXT NOT NULL,
  "notes" TEXT,
  "source" TEXT,
  "reference" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "InventoryMovement_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "InventoryMovement_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "InventoryMovement_partId_fkey" FOREIGN KEY ("partId") REFERENCES "PricebookItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "InventoryMovement_fromLocationId_fkey" FOREIGN KEY ("fromLocationId") REFERENCES "InventoryLocation"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "InventoryMovement_toLocationId_fkey" FOREIGN KEY ("toLocationId") REFERENCES "InventoryLocation"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "InventoryMovement_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "InventoryMovement_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "InventoryMovement_quantity_check" CHECK ("quantity" > 0)
);

CREATE UNIQUE INDEX "InventoryLocation_companyId_name_key" ON "InventoryLocation"("companyId", "name");
CREATE INDEX "InventoryLocation_companyId_active_idx" ON "InventoryLocation"("companyId", "active");
CREATE INDEX "InventoryLocation_companyId_membershipId_idx" ON "InventoryLocation"("companyId", "membershipId");
CREATE UNIQUE INDEX "InventoryStock_companyId_partId_locationId_key" ON "InventoryStock"("companyId", "partId", "locationId");
CREATE INDEX "InventoryStock_companyId_partId_idx" ON "InventoryStock"("companyId", "partId");
CREATE INDEX "InventoryStock_companyId_locationId_idx" ON "InventoryStock"("companyId", "locationId");
CREATE INDEX "JobPart_companyId_jobId_status_idx" ON "JobPart"("companyId", "jobId", "status");
CREATE INDEX "JobPart_companyId_partId_idx" ON "JobPart"("companyId", "partId");
CREATE INDEX "JobPart_companyId_locationId_idx" ON "JobPart"("companyId", "locationId");
CREATE INDEX "InventoryMovement_companyId_partId_createdAt_idx" ON "InventoryMovement"("companyId", "partId", "createdAt");
CREATE INDEX "InventoryMovement_companyId_fromLocationId_createdAt_idx" ON "InventoryMovement"("companyId", "fromLocationId", "createdAt");
CREATE INDEX "InventoryMovement_companyId_toLocationId_createdAt_idx" ON "InventoryMovement"("companyId", "toLocationId", "createdAt");
CREATE INDEX "InventoryMovement_companyId_jobId_idx" ON "InventoryMovement"("companyId", "jobId");
CREATE INDEX "InventoryMovement_companyId_jobPartId_idx" ON "InventoryMovement"("companyId", "jobPartId");
