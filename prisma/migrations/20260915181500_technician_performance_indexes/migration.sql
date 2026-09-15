-- Keep event-driven Technician Intelligence refreshes indexable as job history grows.
CREATE INDEX "Job_companyId_serviceTypeId_completedAt_idx"
  ON "Job"("companyId", "serviceTypeId", "completedAt");

CREATE INDEX "Job_companyId_jobType_completedAt_idx"
  ON "Job"("companyId", "jobType", "completedAt");
