-- AlterTable
ALTER TABLE "Property" ADD COLUMN "geocodingStatus" TEXT DEFAULT 'NONE';
ALTER TABLE "Property" ADD COLUMN "geocodedAt" TIMESTAMP(3);
ALTER TABLE "Property" ADD COLUMN "geocodingProvider" TEXT;
ALTER TABLE "Property" ADD COLUMN "geocodedFormattedAddress" TEXT;
ALTER TABLE "Property" ADD COLUMN "geocodingConfidence" TEXT;
ALTER TABLE "Property" ADD COLUMN "geocodePlaceId" TEXT;
ALTER TABLE "Property" ADD COLUMN "lastGeocodeAttemptAt" TIMESTAMP(3);
ALTER TABLE "Property" ADD COLUMN "geocodeError" TEXT;

-- AlterTable
ALTER TABLE "Company" ADD COLUMN "dispatchPolicyJson" JSONB;

-- CreateTable
CREATE TABLE "TechnicianLocation" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "technicianId" TEXT NOT NULL,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "accuracyMeters" DOUBLE PRECISION,
    "capturedAt" TIMESTAMP(3) NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "source" TEXT NOT NULL,
    "heading" DOUBLE PRECISION,
    "speedMetersPerSecond" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TechnicianLocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RouteMatrixCache" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "originKey" TEXT NOT NULL,
    "destKey" TEXT NOT NULL,
    "durationSeconds" INTEGER NOT NULL,
    "distanceMeters" INTEGER NOT NULL,
    "provider" TEXT NOT NULL,
    "trafficAware" BOOLEAN NOT NULL DEFAULT false,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RouteMatrixCache_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SmartDispatchRecommendation" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "recommendedTechnicianId" TEXT,
    "recommendedScore" INTEGER,
    "candidateJson" JSONB NOT NULL,
    "reasonCodes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "dispatcherDecision" TEXT,
    "assignedTechnicianId" TEXT,
    "actorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SmartDispatchRecommendation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SmartDispatchEvent" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "jobId" TEXT,
    "technicianId" TEXT,
    "payload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SmartDispatchEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TechnicianLocation_companyId_technicianId_key" ON "TechnicianLocation"("companyId", "technicianId");
CREATE INDEX "TechnicianLocation_companyId_capturedAt_idx" ON "TechnicianLocation"("companyId", "capturedAt");
CREATE UNIQUE INDEX "RouteMatrixCache_companyId_originKey_destKey_trafficAware_key" ON "RouteMatrixCache"("companyId", "originKey", "destKey", "trafficAware");
CREATE INDEX "RouteMatrixCache_companyId_computedAt_idx" ON "RouteMatrixCache"("companyId", "computedAt");
CREATE INDEX "SmartDispatchRecommendation_companyId_jobId_createdAt_idx" ON "SmartDispatchRecommendation"("companyId", "jobId", "createdAt");
CREATE INDEX "SmartDispatchEvent_companyId_kind_createdAt_idx" ON "SmartDispatchEvent"("companyId", "kind", "createdAt");
CREATE INDEX "SmartDispatchEvent_companyId_jobId_idx" ON "SmartDispatchEvent"("companyId", "jobId");
CREATE INDEX "Property_companyId_geocodingStatus_idx" ON "Property"("companyId", "geocodingStatus");

ALTER TABLE "TechnicianLocation" ADD CONSTRAINT "TechnicianLocation_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TechnicianLocation" ADD CONSTRAINT "TechnicianLocation_technicianId_fkey" FOREIGN KEY ("technicianId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RouteMatrixCache" ADD CONSTRAINT "RouteMatrixCache_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SmartDispatchRecommendation" ADD CONSTRAINT "SmartDispatchRecommendation_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SmartDispatchRecommendation" ADD CONSTRAINT "SmartDispatchRecommendation_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SmartDispatchEvent" ADD CONSTRAINT "SmartDispatchEvent_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SmartDispatchEvent" ADD CONSTRAINT "SmartDispatchEvent_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE SET NULL ON UPDATE CASCADE;
