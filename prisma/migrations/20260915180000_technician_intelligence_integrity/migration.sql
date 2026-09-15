-- Tighten Technician Intelligence relational and source integrity.
ALTER TABLE "TechnicianJobCategoryMapping"
  ADD CONSTRAINT "TechnicianJobCategoryMapping_serviceTypeId_fkey"
  FOREIGN KEY ("serviceTypeId") REFERENCES "ServiceType"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "TechnicianIntelligenceOverride"
  ADD CONSTRAINT "TechnicianIntelligenceOverride_categoryId_fkey"
  FOREIGN KEY ("categoryId") REFERENCES "TechnicianJobCategory"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "TechnicianSkillRating"
  ADD CONSTRAINT "TechnicianSkillRating_updatedById_fkey"
  FOREIGN KEY ("updatedById") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "TechnicianJobRelationship"
  ADD CONSTRAINT "TechnicianJobRelationship_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "TechnicianJobCategoryMapping"
  ADD CONSTRAINT "TechnicianJobCategoryMapping_one_source_check"
  CHECK (("serviceTypeId" IS NOT NULL) <> ("sourceLabel" IS NOT NULL));
