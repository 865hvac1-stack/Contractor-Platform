-- Additive: preserve leftover imported job fields without rewriting history.
ALTER TABLE "Job" ADD COLUMN "importedSnapshot" JSONB;
ALTER TABLE "Job" ADD COLUMN "importedOccurredAt" TIMESTAMP(3);
ALTER TABLE "Job" ADD COLUMN "importedTotalCents" INTEGER;

CREATE INDEX "ImportRow_companyId_targetRecordId_idx" ON "ImportRow"("companyId", "targetRecordId");
