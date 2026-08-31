-- AlterTable
ALTER TABLE "Payment" ADD COLUMN "refundedCents" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Payment" ADD COLUMN "stripeAccountId" TEXT;
ALTER TABLE "Payment" ADD COLUMN "currency" TEXT NOT NULL DEFAULT 'usd';

-- CreateIndex
CREATE INDEX "Payment_companyId_status_idx" ON "Payment"("companyId", "status");

-- CreateTable
CREATE TABLE "StripeConnectAccount" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "stripeAccountId" TEXT NOT NULL,
    "onboardingStatus" TEXT NOT NULL DEFAULT 'ONBOARDING',
    "chargesEnabled" BOOLEAN NOT NULL DEFAULT false,
    "payoutsEnabled" BOOLEAN NOT NULL DEFAULT false,
    "detailsSubmitted" BOOLEAN NOT NULL DEFAULT false,
    "requirementsDue" TEXT,
    "payoutSchedule" TEXT,
    "bankLast4" TEXT,
    "bankName" TEXT,
    "disabledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StripeConnectAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StripeWebhookEvent" (
    "id" TEXT NOT NULL,
    "companyId" TEXT,
    "eventType" TEXT NOT NULL,
    "processedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StripeWebhookEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "StripeConnectAccount_companyId_key" ON "StripeConnectAccount"("companyId");
CREATE UNIQUE INDEX "StripeConnectAccount_stripeAccountId_key" ON "StripeConnectAccount"("stripeAccountId");
CREATE INDEX "StripeConnectAccount_onboardingStatus_idx" ON "StripeConnectAccount"("onboardingStatus");
CREATE INDEX "StripeWebhookEvent_eventType_createdAt_idx" ON "StripeWebhookEvent"("eventType", "createdAt");
CREATE INDEX "StripeWebhookEvent_companyId_idx" ON "StripeWebhookEvent"("companyId");

-- AddForeignKey
ALTER TABLE "StripeConnectAccount" ADD CONSTRAINT "StripeConnectAccount_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StripeWebhookEvent" ADD CONSTRAINT "StripeWebhookEvent_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;
