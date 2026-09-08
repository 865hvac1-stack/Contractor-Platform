-- CreateEnum
CREATE TYPE "AppointmentDaypart" AS ENUM ('MORNING', 'AFTERNOON', 'EVENING', 'ANY');

-- CreateEnum
CREATE TYPE "ConversationSchedulingStatus" AS ENUM ('OPEN', 'CLARIFYING', 'SUGGESTED', 'BOOKED', 'CANCELED', 'NEEDS_REVIEW', 'PAUSED');

-- CreateEnum
CREATE TYPE "MaintenanceVisitStatus" AS ENUM ('NOT_YET_DUE', 'DUE_SOON', 'UNSCHEDULED', 'SCHEDULED', 'COMPLETED', 'OVERDUE', 'CANCELED', 'NEEDS_RESCHEDULE');

-- CreateEnum
CREATE TYPE "SchedulingBookingSource" AS ENUM ('AUTO', 'MANUAL', 'CONVERSATION', 'MAINTENANCE');

-- AlterTable
ALTER TABLE "Job" ADD COLUMN "appointmentWindowId" TEXT;
ALTER TABLE "Job" ADD COLUMN "bookedByContractorYou" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Job" ADD COLUMN "confirmationFailed" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Job" ADD COLUMN "schedulingIdempotencyKey" TEXT;

-- AlterTable
ALTER TABLE "MembershipPlan" ADD COLUMN "visitsPerYear" INTEGER;
ALTER TABLE "MembershipPlan" ADD COLUMN "cadenceMonths" INTEGER;
ALTER TABLE "MembershipPlan" ADD COLUMN "dueSoonDays" INTEGER NOT NULL DEFAULT 45;

-- CreateTable
CREATE TABLE "AppointmentWindow" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "label" TEXT,
    "startMinutes" INTEGER NOT NULL,
    "endMinutes" INTEGER NOT NULL,
    "daypart" "AppointmentDaypart" NOT NULL DEFAULT 'ANY',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AppointmentWindow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TechnicianWindowAvailability" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "windowId" TEXT NOT NULL,
    "weekday" INTEGER NOT NULL,
    "available" BOOLEAN NOT NULL DEFAULT true,
    "capacity" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TechnicianWindowAvailability_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AvailabilityOverride" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "windowId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "available" BOOLEAN NOT NULL,
    "capacity" INTEGER,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AvailabilityOverride_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SchedulingPolicy" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "autoBookingEnabled" BOOLEAN NOT NULL DEFAULT false,
    "allowSameDay" BOOLEAN NOT NULL DEFAULT true,
    "allowWeekend" BOOLEAN NOT NULL DEFAULT false,
    "minNoticeMinutes" INTEGER NOT NULL DEFAULT 120,
    "standardHorizonDays" INTEGER NOT NULL DEFAULT 90,
    "maintenanceHorizonDays" INTEGER NOT NULL DEFAULT 365,
    "maxJobsPerWindow" INTEGER,
    "maxJobsPerDay" INTEGER,
    "emergencyReservePerWindow" INTEGER NOT NULL DEFAULT 0,
    "allowEmergencyReserveUse" BOOLEAN NOT NULL DEFAULT false,
    "allowTechnicianPreference" BOOLEAN NOT NULL DEFAULT true,
    "allowOfficeOverride" BOOLEAN NOT NULL DEFAULT true,
    "autoCancelEnabled" BOOLEAN NOT NULL DEFAULT false,
    "showTechnicianName" BOOLEAN NOT NULL DEFAULT false,
    "allowPaidOneTimeMaintenance" BOOLEAN NOT NULL DEFAULT false,
    "confirmationTemplate" TEXT,
    "noAvailabilityTemplate" TEXT,
    "clarificationTemplate" TEXT,
    "maintenanceDuplicateTemplate" TEXT,
    "noPlanTemplate" TEXT,
    "defaultServiceTypeId" TEXT,
    "maintenanceServiceTypeId" TEXT,
    "proactiveOutreachEnabled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SchedulingPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ServiceTypeSchedulingRule" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "serviceTypeId" TEXT NOT NULL,
    "autoBookAllowed" BOOLEAN NOT NULL DEFAULT true,
    "requiresOfficeApproval" BOOLEAN NOT NULL DEFAULT false,
    "isMaintenance" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ServiceTypeSchedulingRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TechnicianServiceEligibility" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "serviceTypeId" TEXT NOT NULL,
    "eligible" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TechnicianServiceEligibility_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConversationSchedulingState" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "customerId" TEXT,
    "status" "ConversationSchedulingStatus" NOT NULL DEFAULT 'OPEN',
    "requestedDate" DATE,
    "requestedDateEnd" DATE,
    "requestedDaypart" "AppointmentDaypart",
    "requestedWindowId" TEXT,
    "serviceTypeId" TEXT,
    "serviceIntent" TEXT,
    "maintenanceIntent" BOOLEAN NOT NULL DEFAULT false,
    "urgency" TEXT,
    "rescheduleIntent" BOOLEAN NOT NULL DEFAULT false,
    "cancelIntent" BOOLEAN NOT NULL DEFAULT false,
    "lastInboundMessageId" TEXT,
    "missingField" TEXT,
    "suggestedJobId" TEXT,
    "bookedJobId" TEXT,
    "paused" BOOLEAN NOT NULL DEFAULT false,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ConversationSchedulingState_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MaintenanceVisit" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "cycleKey" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "dueStart" DATE NOT NULL,
    "dueEnd" DATE NOT NULL,
    "status" "MaintenanceVisitStatus" NOT NULL DEFAULT 'UNSCHEDULED',
    "jobId" TEXT,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MaintenanceVisit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SchedulingBooking" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "windowId" TEXT NOT NULL,
    "technicianUserId" TEXT NOT NULL,
    "localDate" DATE NOT NULL,
    "slotIndex" INTEGER NOT NULL DEFAULT 0,
    "source" "SchedulingBookingSource" NOT NULL DEFAULT 'MANUAL',
    "idempotencyKey" TEXT NOT NULL,
    "inboundMessageId" TEXT,
    "threadId" TEXT,
    "maintenanceVisitId" TEXT,
    "confirmationStatus" TEXT NOT NULL DEFAULT 'PENDING',
    "confirmationError" TEXT,
    "autoAssigned" BOOLEAN NOT NULL DEFAULT true,
    "rankingReason" JSONB,
    "releasedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SchedulingBooking_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AppointmentWindow_companyId_active_sortOrder_idx" ON "AppointmentWindow"("companyId", "active", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "TechWindowAvail_company_user_window_weekday_key" ON "TechnicianWindowAvailability"("companyId", "userId", "windowId", "weekday");

-- CreateIndex
CREATE INDEX "TechnicianWindowAvailability_companyId_userId_weekday_idx" ON "TechnicianWindowAvailability"("companyId", "userId", "weekday");

-- CreateIndex
CREATE UNIQUE INDEX "AvailabilityOverride_companyId_userId_windowId_date_key" ON "AvailabilityOverride"("companyId", "userId", "windowId", "date");

-- CreateIndex
CREATE INDEX "AvailabilityOverride_companyId_date_idx" ON "AvailabilityOverride"("companyId", "date");

-- CreateIndex
CREATE INDEX "AvailabilityOverride_companyId_userId_date_idx" ON "AvailabilityOverride"("companyId", "userId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "SchedulingPolicy_companyId_key" ON "SchedulingPolicy"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "ServiceTypeSchedulingRule_companyId_serviceTypeId_key" ON "ServiceTypeSchedulingRule"("companyId", "serviceTypeId");

-- CreateIndex
CREATE UNIQUE INDEX "TechServiceElig_company_user_type_key" ON "TechnicianServiceEligibility"("companyId", "userId", "serviceTypeId");

-- CreateIndex
CREATE INDEX "TechnicianServiceEligibility_companyId_serviceTypeId_idx" ON "TechnicianServiceEligibility"("companyId", "serviceTypeId");

-- CreateIndex
CREATE UNIQUE INDEX "ConvSchedState_company_inbound_key" ON "ConversationSchedulingState"("companyId", "lastInboundMessageId");

-- CreateIndex
CREATE INDEX "ConversationSchedulingState_companyId_threadId_status_idx" ON "ConversationSchedulingState"("companyId", "threadId", "status");

-- CreateIndex
CREATE INDEX "ConversationSchedulingState_companyId_customerId_status_idx" ON "ConversationSchedulingState"("companyId", "customerId", "status");

-- CreateIndex
CREATE INDEX "ConversationSchedulingState_companyId_expiresAt_idx" ON "ConversationSchedulingState"("companyId", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "MaintenanceVisit_companyId_membershipId_cycleKey_key" ON "MaintenanceVisit"("companyId", "membershipId", "cycleKey");

-- CreateIndex
CREATE INDEX "MaintenanceVisit_companyId_status_dueStart_idx" ON "MaintenanceVisit"("companyId", "status", "dueStart");

-- CreateIndex
CREATE INDEX "MaintenanceVisit_companyId_customerId_idx" ON "MaintenanceVisit"("companyId", "customerId");

-- CreateIndex
CREATE UNIQUE INDEX "SchedulingBooking_jobId_key" ON "SchedulingBooking"("jobId");

-- CreateIndex
CREATE UNIQUE INDEX "SchedulingBooking_companyId_idempotencyKey_key" ON "SchedulingBooking"("companyId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "SchedulingBooking_slot_unique" ON "SchedulingBooking"("companyId", "technicianUserId", "windowId", "localDate", "slotIndex");

-- CreateIndex
CREATE INDEX "SchedulingBooking_companyId_localDate_windowId_idx" ON "SchedulingBooking"("companyId", "localDate", "windowId");

-- CreateIndex
CREATE INDEX "SchedulingBooking_companyId_technicianUserId_localDate_idx" ON "SchedulingBooking"("companyId", "technicianUserId", "localDate");

-- CreateIndex
CREATE INDEX "SchedulingBooking_companyId_maintenanceVisitId_idx" ON "SchedulingBooking"("companyId", "maintenanceVisitId");

-- CreateIndex
CREATE UNIQUE INDEX "Job_companyId_schedulingIdempotencyKey_key" ON "Job"("companyId", "schedulingIdempotencyKey");

-- AddForeignKey
ALTER TABLE "Job" ADD CONSTRAINT "Job_appointmentWindowId_fkey" FOREIGN KEY ("appointmentWindowId") REFERENCES "AppointmentWindow"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AppointmentWindow" ADD CONSTRAINT "AppointmentWindow_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TechnicianWindowAvailability" ADD CONSTRAINT "TechnicianWindowAvailability_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TechnicianWindowAvailability" ADD CONSTRAINT "TechnicianWindowAvailability_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TechnicianWindowAvailability" ADD CONSTRAINT "TechnicianWindowAvailability_windowId_fkey" FOREIGN KEY ("windowId") REFERENCES "AppointmentWindow"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AvailabilityOverride" ADD CONSTRAINT "AvailabilityOverride_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AvailabilityOverride" ADD CONSTRAINT "AvailabilityOverride_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AvailabilityOverride" ADD CONSTRAINT "AvailabilityOverride_windowId_fkey" FOREIGN KEY ("windowId") REFERENCES "AppointmentWindow"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SchedulingPolicy" ADD CONSTRAINT "SchedulingPolicy_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SchedulingPolicy" ADD CONSTRAINT "SchedulingPolicy_defaultServiceTypeId_fkey" FOREIGN KEY ("defaultServiceTypeId") REFERENCES "ServiceType"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SchedulingPolicy" ADD CONSTRAINT "SchedulingPolicy_maintenanceServiceTypeId_fkey" FOREIGN KEY ("maintenanceServiceTypeId") REFERENCES "ServiceType"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceTypeSchedulingRule" ADD CONSTRAINT "ServiceTypeSchedulingRule_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceTypeSchedulingRule" ADD CONSTRAINT "ServiceTypeSchedulingRule_serviceTypeId_fkey" FOREIGN KEY ("serviceTypeId") REFERENCES "ServiceType"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TechnicianServiceEligibility" ADD CONSTRAINT "TechnicianServiceEligibility_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TechnicianServiceEligibility" ADD CONSTRAINT "TechnicianServiceEligibility_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TechnicianServiceEligibility" ADD CONSTRAINT "TechnicianServiceEligibility_serviceTypeId_fkey" FOREIGN KEY ("serviceTypeId") REFERENCES "ServiceType"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConversationSchedulingState" ADD CONSTRAINT "ConversationSchedulingState_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConversationSchedulingState" ADD CONSTRAINT "ConversationSchedulingState_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "CommunicationThread"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConversationSchedulingState" ADD CONSTRAINT "ConversationSchedulingState_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConversationSchedulingState" ADD CONSTRAINT "ConversationSchedulingState_requestedWindowId_fkey" FOREIGN KEY ("requestedWindowId") REFERENCES "AppointmentWindow"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConversationSchedulingState" ADD CONSTRAINT "ConversationSchedulingState_bookedJobId_fkey" FOREIGN KEY ("bookedJobId") REFERENCES "Job"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaintenanceVisit" ADD CONSTRAINT "MaintenanceVisit_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaintenanceVisit" ADD CONSTRAINT "MaintenanceVisit_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "CustomerMembership"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaintenanceVisit" ADD CONSTRAINT "MaintenanceVisit_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaintenanceVisit" ADD CONSTRAINT "MaintenanceVisit_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SchedulingBooking" ADD CONSTRAINT "SchedulingBooking_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SchedulingBooking" ADD CONSTRAINT "SchedulingBooking_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SchedulingBooking" ADD CONSTRAINT "SchedulingBooking_windowId_fkey" FOREIGN KEY ("windowId") REFERENCES "AppointmentWindow"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SchedulingBooking" ADD CONSTRAINT "SchedulingBooking_technicianUserId_fkey" FOREIGN KEY ("technicianUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SchedulingBooking" ADD CONSTRAINT "SchedulingBooking_maintenanceVisitId_fkey" FOREIGN KEY ("maintenanceVisitId") REFERENCES "MaintenanceVisit"("id") ON DELETE SET NULL ON UPDATE CASCADE;
