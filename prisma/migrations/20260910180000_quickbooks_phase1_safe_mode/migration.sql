-- Safe-mode sync controls and richer mapping metadata. Existing connections stay inactive until the wizard completes.
ALTER TABLE "QuickBooksSettings" ADD COLUMN IF NOT EXISTS "syncActivated" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "QuickBooksSettings" ADD COLUMN IF NOT EXISTS "syncStartDate" DATE;
ALTER TABLE "QuickBooksSettings" ADD COLUMN IF NOT EXISTS "qboCompanyName" TEXT;
ALTER TABLE "QuickBooksSettings" ADD COLUMN IF NOT EXISTS "qboCompanyVerifiedAt" TIMESTAMP(3);
ALTER TABLE "QuickBooksSettings" ADD COLUMN IF NOT EXISTS "wizardCompletedAt" TIMESTAMP(3);

ALTER TABLE "QuickBooksMapping" ADD COLUMN IF NOT EXISTS "lastSyncError" TEXT;
ALTER TABLE "QuickBooksMapping" ADD COLUMN IF NOT EXISTS "syncToken" TEXT;
ALTER TABLE "QuickBooksMapping" ADD COLUMN IF NOT EXISTS "metadata" JSONB;
