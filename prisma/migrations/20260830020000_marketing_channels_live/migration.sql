-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "IntegrationStatus" ADD VALUE 'SELECT_ACCOUNT';
ALTER TYPE "IntegrationStatus" ADD VALUE 'SYNCING';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "LeadSource" ADD VALUE 'TIKTOK';
ALTER TYPE "LeadSource" ADD VALUE 'LINKEDIN';
ALTER TYPE "LeadSource" ADD VALUE 'YOUTUBE';
ALTER TYPE "LeadSource" ADD VALUE 'META_ADS';

-- AlterTable
ALTER TABLE "FormSubmission" ADD COLUMN     "landingPageId" TEXT,
ADD COLUMN     "websiteFormId" TEXT;

-- AlterTable
ALTER TABLE "IntegrationConnection" ADD COLUMN     "lastAttemptAt" TIMESTAMP(3),
ADD COLUMN     "nextSyncAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "SocialPost" ADD COLUMN     "ctaLabel" TEXT,
ADD COLUMN     "linkUrl" TEXT,
ADD COLUMN     "mediaUrl" TEXT;

-- CreateTable
CREATE TABLE "IntegrationAccount" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "providerKey" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "selected" BOOLEAN NOT NULL DEFAULT false,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IntegrationAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OAuthState" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "providerKey" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "codeVerifier" TEXT,
    "redirectTo" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OAuthState_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebsiteForm" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "fields" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "honeypot" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WebsiteForm_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LandingPage" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "formId" TEXT,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "headline" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "ctaLabel" TEXT NOT NULL DEFAULT 'Request service',
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LandingPage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrackingNumber" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "phoneNumber" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "campaign" TEXT,
    "channel" TEXT,
    "provider" TEXT,
    "status" TEXT NOT NULL DEFAULT 'INACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TrackingNumber_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SocialPostPublication" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "externalId" TEXT,
    "errorMessage" TEXT,
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SocialPostPublication_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "IntegrationAccount_companyId_connectionId_idx" ON "IntegrationAccount"("companyId", "connectionId");

-- CreateIndex
CREATE UNIQUE INDEX "IntegrationAccount_connectionId_kind_externalId_key" ON "IntegrationAccount"("connectionId", "kind", "externalId");

-- CreateIndex
CREATE UNIQUE INDEX "OAuthState_state_key" ON "OAuthState"("state");

-- CreateIndex
CREATE INDEX "OAuthState_companyId_idx" ON "OAuthState"("companyId");

-- CreateIndex
CREATE INDEX "OAuthState_expiresAt_idx" ON "OAuthState"("expiresAt");

-- CreateIndex
CREATE INDEX "WebsiteForm_companyId_idx" ON "WebsiteForm"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "WebsiteForm_companyId_slug_key" ON "WebsiteForm"("companyId", "slug");

-- CreateIndex
CREATE INDEX "LandingPage_companyId_idx" ON "LandingPage"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "LandingPage_companyId_slug_key" ON "LandingPage"("companyId", "slug");

-- CreateIndex
CREATE INDEX "TrackingNumber_companyId_idx" ON "TrackingNumber"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "TrackingNumber_companyId_phoneNumber_key" ON "TrackingNumber"("companyId", "phoneNumber");

-- CreateIndex
CREATE INDEX "SocialPostPublication_companyId_postId_idx" ON "SocialPostPublication"("companyId", "postId");

-- CreateIndex
CREATE UNIQUE INDEX "SocialPostPublication_postId_channel_key" ON "SocialPostPublication"("postId", "channel");

-- CreateIndex
CREATE INDEX "FormSubmission_companyId_websiteFormId_idx" ON "FormSubmission"("companyId", "websiteFormId");

-- CreateIndex
CREATE UNIQUE INDEX "IntegrationEvent_companyId_connectionId_externalId_key" ON "IntegrationEvent"("companyId", "connectionId", "externalId");

-- CreateIndex
CREATE UNIQUE INDEX "MarketingSpend_companyId_provider_externalId_key" ON "MarketingSpend"("companyId", "provider", "externalId");

-- AddForeignKey
ALTER TABLE "IntegrationAccount" ADD CONSTRAINT "IntegrationAccount_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IntegrationAccount" ADD CONSTRAINT "IntegrationAccount_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "IntegrationConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OAuthState" ADD CONSTRAINT "OAuthState_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OAuthState" ADD CONSTRAINT "OAuthState_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebsiteForm" ADD CONSTRAINT "WebsiteForm_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LandingPage" ADD CONSTRAINT "LandingPage_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LandingPage" ADD CONSTRAINT "LandingPage_formId_fkey" FOREIGN KEY ("formId") REFERENCES "WebsiteForm"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrackingNumber" ADD CONSTRAINT "TrackingNumber_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SocialPostPublication" ADD CONSTRAINT "SocialPostPublication_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SocialPostPublication" ADD CONSTRAINT "SocialPostPublication_postId_fkey" FOREIGN KEY ("postId") REFERENCES "SocialPost"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FormSubmission" ADD CONSTRAINT "FormSubmission_websiteFormId_fkey" FOREIGN KEY ("websiteFormId") REFERENCES "WebsiteForm"("id") ON DELETE SET NULL ON UPDATE CASCADE;

