-- Additive review-workflow metadata only. No ContractorYou customer or QuickBooks data is changed.
ALTER TABLE "QuickBooksImportReview" ADD COLUMN IF NOT EXISTS "searchText" TEXT;
ALTER TABLE "QuickBooksImportReview" ADD COLUMN IF NOT EXISTS "reviewFingerprint" TEXT;
ALTER TABLE "QuickBooksImportReview" ADD COLUMN IF NOT EXISTS "safeAutoApprove" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "QuickBooksImportReview" ADD COLUMN IF NOT EXISTS "confidenceScore" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "QuickBooksImportReview" ADD COLUMN IF NOT EXISTS "differenceCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "QuickBooksImportReview" ADD COLUMN IF NOT EXISTS "reviewedAt" TIMESTAMP(3);
ALTER TABLE "QuickBooksImportReview" ADD COLUMN IF NOT EXISTS "reviewedById" TEXT;

CREATE INDEX IF NOT EXISTS "QuickBooksImportReview_companyId_objectType_confidence_status_idx"
  ON "QuickBooksImportReview"("companyId", "objectType", "confidence", "status");
