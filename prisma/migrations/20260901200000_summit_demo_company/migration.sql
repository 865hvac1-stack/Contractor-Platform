-- Additive demo-tenant branding and isolation flag. Existing companies stay intact.

ALTER TABLE "Company" ADD COLUMN IF NOT EXISTS "accentColor" TEXT;
ALTER TABLE "Company" ADD COLUMN IF NOT EXISTS "tagline" TEXT;
ALTER TABLE "Company" ADD COLUMN IF NOT EXISTS "description" TEXT;
ALTER TABLE "Company" ADD COLUMN IF NOT EXISTS "hoursNote" TEXT;
ALTER TABLE "Company" ADD COLUMN IF NOT EXISTS "isDemo" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS "Company_isDemo_idx" ON "Company"("isDemo");
