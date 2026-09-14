-- Review-plan metadata only. No customer or QuickBooks records are modified.
ALTER TABLE "QuickBooksImportReview" ADD COLUMN IF NOT EXISTS "autoApprovalTier" TEXT;
ALTER TABLE "QuickBooksImportReview" ADD COLUMN IF NOT EXISTS "autoApprovalBlocker" TEXT;

CREATE INDEX IF NOT EXISTS "QuickBooksImportReview_company_object_blocker_idx"
  ON "QuickBooksImportReview"("companyId", "objectType", "autoApprovalBlocker");
