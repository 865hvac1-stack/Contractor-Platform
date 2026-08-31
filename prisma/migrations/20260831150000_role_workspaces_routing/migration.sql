-- AlterTable
ALTER TABLE "Job" ADD COLUMN "scheduleLocked" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Job" ADD COLUMN "routeOrder" INTEGER;

-- AlterTable
ALTER TABLE "Company" ADD COLUMN "routeStartKind" TEXT;
ALTER TABLE "Company" ADD COLUMN "routeEndKind" TEXT;

-- AlterTable
ALTER TABLE "Membership" ADD COLUMN "routeStartKind" TEXT;
ALTER TABLE "Membership" ADD COLUMN "routeEndKind" TEXT;
ALTER TABLE "Membership" ADD COLUMN "homeAddress" TEXT;
ALTER TABLE "Membership" ADD COLUMN "homeCity" TEXT;
ALTER TABLE "Membership" ADD COLUMN "homeState" TEXT;
ALTER TABLE "Membership" ADD COLUMN "homeZip" TEXT;

-- CreateTable
CREATE TABLE "RouteOptimizationRun" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "technicianUserId" TEXT NOT NULL,
    "day" TIMESTAMP(3) NOT NULL,
    "actorId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "currentSeconds" INTEGER,
    "suggestedSeconds" INTEGER,
    "currentMeters" INTEGER,
    "suggestedMeters" INTEGER,
    "currentJobIds" TEXT NOT NULL,
    "suggestedJobIds" TEXT NOT NULL,
    "error" TEXT,
    "appliedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RouteOptimizationRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Job_companyId_scheduleLocked_idx" ON "Job"("companyId", "scheduleLocked");
CREATE INDEX "RouteOptimizationRun_companyId_technicianUserId_day_idx" ON "RouteOptimizationRun"("companyId", "technicianUserId", "day");
CREATE INDEX "RouteOptimizationRun_companyId_createdAt_idx" ON "RouteOptimizationRun"("companyId", "createdAt");

-- AddForeignKey
ALTER TABLE "RouteOptimizationRun" ADD CONSTRAINT "RouteOptimizationRun_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
