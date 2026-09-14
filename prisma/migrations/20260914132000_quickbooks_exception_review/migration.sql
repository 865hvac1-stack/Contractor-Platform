-- Stage 1 exception-review metadata only. This migration does not alter customer
-- records, execute imports, merge customers, or write to QuickBooks.
ALTER TABLE "QuickBooksImportReview"
  ADD COLUMN IF NOT EXISTS "resolutionType" TEXT,
  ADD COLUMN IF NOT EXISTS "sourceFingerprint" TEXT,
  ADD COLUMN IF NOT EXISTS "candidateFingerprint" TEXT,
  ADD COLUMN IF NOT EXISTS "skippedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "skipCount" INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS "QuickBooksImportReview_exception_queue_idx"
  ON "QuickBooksImportReview"(
    "companyId",
    "environment",
    "realmId",
    "objectType",
    "status",
    "skippedAt"
  );

CREATE TABLE IF NOT EXISTS "QuickBooksReviewDecision" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "environment" TEXT NOT NULL,
  "realmId" TEXT NOT NULL,
  "analysisRunId" TEXT,
  "reviewId" TEXT NOT NULL,
  "quickbooksId" TEXT NOT NULL,
  "resolutionType" TEXT NOT NULL,
  "selectedCustomerId" TEXT,
  "sourceFingerprint" TEXT NOT NULL,
  "candidateFingerprint" TEXT,
  "previousState" JSONB NOT NULL,
  "resultingState" JSONB NOT NULL,
  "actorId" TEXT NOT NULL,
  "undoneAt" TIMESTAMP(3),
  "undoneById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "QuickBooksReviewDecision_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "QuickBooksReviewDecision_scope_created_idx"
  ON "QuickBooksReviewDecision"("companyId", "environment", "realmId", "createdAt");
CREATE INDEX IF NOT EXISTS "QuickBooksReviewDecision_review_created_idx"
  ON "QuickBooksReviewDecision"("reviewId", "createdAt");
CREATE INDEX IF NOT EXISTS "QuickBooksReviewDecision_actor_created_idx"
  ON "QuickBooksReviewDecision"("actorId", "createdAt");

CREATE TABLE IF NOT EXISTS "QuickBooksMergeReview" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "environment" TEXT NOT NULL,
  "realmId" TEXT NOT NULL,
  "analysisRunId" TEXT,
  "sourceReviewId" TEXT NOT NULL,
  "customerAId" TEXT NOT NULL,
  "customerBId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'OPEN',
  "flaggedById" TEXT NOT NULL,
  "sourceFingerprint" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "QuickBooksMergeReview_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "QuickBooksMergeReview_pair_key"
  ON "QuickBooksMergeReview"("companyId", "environment", "realmId", "customerAId", "customerBId");
CREATE INDEX IF NOT EXISTS "QuickBooksMergeReview_company_status_created_idx"
  ON "QuickBooksMergeReview"("companyId", "status", "createdAt");
CREATE INDEX IF NOT EXISTS "QuickBooksMergeReview_source_review_idx"
  ON "QuickBooksMergeReview"("sourceReviewId");
