-- Additive HighLevel communications/social fields. Existing records stay intact.

ALTER TABLE "CommunicationThread" ADD COLUMN IF NOT EXISTS "email" TEXT;
ALTER TABLE "SocialPost" ADD COLUMN IF NOT EXISTS "provider" TEXT;
ALTER TABLE "SocialPost" ADD COLUMN IF NOT EXISTS "externalId" TEXT;
