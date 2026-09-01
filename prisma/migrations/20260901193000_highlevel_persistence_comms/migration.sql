-- Additive HighLevel persistence + communication diagnostics. Existing records stay intact.

ALTER TABLE "CommunicationThread" ADD COLUMN IF NOT EXISTS "externalContactId" TEXT;
ALTER TABLE "IntegrationSync" ADD COLUMN IF NOT EXISTS "summary" JSONB;

CREATE INDEX IF NOT EXISTS "CommunicationThread_companyId_externalContactId_idx"
  ON "CommunicationThread"("companyId", "externalContactId");
