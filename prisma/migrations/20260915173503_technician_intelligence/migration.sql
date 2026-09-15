-- CreateTable
CREATE TABLE "TechnicianIntelligenceProfile" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "technicianId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'NEEDS_SETUP',
    "evaluationCompletedAt" TIMESTAMP(3),
    "evaluationCompletedById" TEXT,
    "evaluationUpdatedAt" TIMESTAMP(3),
    "notes" TEXT,
    "smartDispatchEligible" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TechnicianIntelligenceProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TechnicianJobCategory" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "aliases" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TechnicianJobCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TechnicianJobCategoryMapping" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "serviceTypeId" TEXT,
    "sourceLabel" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TechnicianJobCategoryMapping_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TechnicianSkillDefinition" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "categoryId" TEXT,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "group" TEXT NOT NULL DEFAULT 'SERVICE',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TechnicianSkillDefinition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TechnicianSkillRating" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "skillId" TEXT NOT NULL,
    "rating" INTEGER NOT NULL,
    "managerNote" TEXT,
    "updatedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TechnicianSkillRating_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TechnicianQualificationDefinition" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TechnicianQualificationDefinition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TechnicianQualification" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "definitionId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "issuedDate" DATE,
    "expirationDate" DATE,
    "certificationNumber" TEXT,
    "documentId" TEXT,
    "notes" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TechnicianQualification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TechnicianJobTypeRequirement" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "qualificationDefinitionId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TechnicianJobTypeRequirement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TechnicianCallPreference" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "preference" TEXT NOT NULL,
    "reason" TEXT,
    "changedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TechnicianCallPreference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TechnicianPerformanceAggregate" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "window" TEXT NOT NULL,
    "windowStart" TIMESTAMP(3),
    "windowEnd" TIMESTAMP(3),
    "completedJobs" INTEGER NOT NULL DEFAULT 0,
    "recognizedRevenueCents" INTEGER NOT NULL DEFAULT 0,
    "invoiceCount" INTEGER NOT NULL DEFAULT 0,
    "callbackCount" INTEGER NOT NULL DEFAULT 0,
    "firstTimeCompletionCount" INTEGER NOT NULL DEFAULT 0,
    "validDurationCount" INTEGER NOT NULL DEFAULT 0,
    "totalDurationMinutes" INTEGER NOT NULL DEFAULT 0,
    "estimatePresentedCount" INTEGER NOT NULL DEFAULT 0,
    "estimateApprovedCount" INTEGER NOT NULL DEFAULT 0,
    "confidence" TEXT NOT NULL DEFAULT 'INSUFFICIENT',
    "calculatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sourceThrough" TIMESTAMP(3),

    CONSTRAINT "TechnicianPerformanceAggregate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TechnicianIntelligenceOverride" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "categoryId" TEXT,
    "kind" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "reason" TEXT NOT NULL,
    "changedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TechnicianIntelligenceOverride_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TechnicianJobRelationship" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "originalJobId" TEXT NOT NULL,
    "relatedJobId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "reason" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TechnicianJobRelationship_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TechnicianIntelligenceProfile_companyId_status_smartDispatc_idx" ON "TechnicianIntelligenceProfile"("companyId", "status", "smartDispatchEligible");

-- CreateIndex
CREATE UNIQUE INDEX "TechnicianIntelligenceProfile_companyId_technicianId_key" ON "TechnicianIntelligenceProfile"("companyId", "technicianId");

-- CreateIndex
CREATE INDEX "TechnicianJobCategory_companyId_active_sortOrder_idx" ON "TechnicianJobCategory"("companyId", "active", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "TechnicianJobCategory_companyId_key_key" ON "TechnicianJobCategory"("companyId", "key");

-- CreateIndex
CREATE INDEX "TechnicianJobCategoryMapping_companyId_categoryId_idx" ON "TechnicianJobCategoryMapping"("companyId", "categoryId");

-- CreateIndex
CREATE UNIQUE INDEX "TechnicianJobCategoryMapping_companyId_serviceTypeId_key" ON "TechnicianJobCategoryMapping"("companyId", "serviceTypeId");

-- CreateIndex
CREATE UNIQUE INDEX "TechnicianJobCategoryMapping_companyId_sourceLabel_key" ON "TechnicianJobCategoryMapping"("companyId", "sourceLabel");

-- CreateIndex
CREATE INDEX "TechnicianSkillDefinition_companyId_active_group_sortOrder_idx" ON "TechnicianSkillDefinition"("companyId", "active", "group", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "TechnicianSkillDefinition_companyId_key_key" ON "TechnicianSkillDefinition"("companyId", "key");

-- CreateIndex
CREATE INDEX "TechnicianSkillRating_companyId_skillId_rating_idx" ON "TechnicianSkillRating"("companyId", "skillId", "rating");

-- CreateIndex
CREATE UNIQUE INDEX "TechnicianSkillRating_profileId_skillId_key" ON "TechnicianSkillRating"("profileId", "skillId");

-- CreateIndex
CREATE INDEX "TechnicianQualificationDefinition_companyId_active_sortOrde_idx" ON "TechnicianQualificationDefinition"("companyId", "active", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "TechnicianQualificationDefinition_companyId_key_key" ON "TechnicianQualificationDefinition"("companyId", "key");

-- CreateIndex
CREATE INDEX "TechnicianQualification_companyId_definitionId_status_expir_idx" ON "TechnicianQualification"("companyId", "definitionId", "status", "expirationDate");

-- CreateIndex
CREATE UNIQUE INDEX "TechnicianQualification_profileId_definitionId_key" ON "TechnicianQualification"("profileId", "definitionId");

-- CreateIndex
CREATE INDEX "TechnicianJobTypeRequirement_companyId_categoryId_idx" ON "TechnicianJobTypeRequirement"("companyId", "categoryId");

-- CreateIndex
CREATE UNIQUE INDEX "TechnicianJobTypeRequirement_categoryId_qualificationDefini_key" ON "TechnicianJobTypeRequirement"("categoryId", "qualificationDefinitionId");

-- CreateIndex
CREATE INDEX "TechnicianCallPreference_companyId_categoryId_preference_idx" ON "TechnicianCallPreference"("companyId", "categoryId", "preference");

-- CreateIndex
CREATE UNIQUE INDEX "TechnicianCallPreference_profileId_categoryId_key" ON "TechnicianCallPreference"("profileId", "categoryId");

-- CreateIndex
CREATE INDEX "TechnicianPerformanceAggregate_companyId_categoryId_window__idx" ON "TechnicianPerformanceAggregate"("companyId", "categoryId", "window", "completedJobs");

-- CreateIndex
CREATE UNIQUE INDEX "TechnicianPerformanceAggregate_profileId_categoryId_window_key" ON "TechnicianPerformanceAggregate"("profileId", "categoryId", "window");

-- CreateIndex
CREATE INDEX "TechnicianIntelligenceOverride_companyId_profileId_active_idx" ON "TechnicianIntelligenceOverride"("companyId", "profileId", "active");

-- CreateIndex
CREATE INDEX "TechnicianIntelligenceOverride_companyId_categoryId_active_idx" ON "TechnicianIntelligenceOverride"("companyId", "categoryId", "active");

-- CreateIndex
CREATE INDEX "TechnicianJobRelationship_companyId_originalJobId_type_idx" ON "TechnicianJobRelationship"("companyId", "originalJobId", "type");

-- CreateIndex
CREATE INDEX "TechnicianJobRelationship_companyId_relatedJobId_type_idx" ON "TechnicianJobRelationship"("companyId", "relatedJobId", "type");

-- CreateIndex
CREATE UNIQUE INDEX "TechnicianJobRelationship_companyId_originalJobId_relatedJo_key" ON "TechnicianJobRelationship"("companyId", "originalJobId", "relatedJobId", "type");

-- AddForeignKey
ALTER TABLE "TechnicianIntelligenceProfile" ADD CONSTRAINT "TechnicianIntelligenceProfile_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TechnicianIntelligenceProfile" ADD CONSTRAINT "TechnicianIntelligenceProfile_technicianId_fkey" FOREIGN KEY ("technicianId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TechnicianIntelligenceProfile" ADD CONSTRAINT "TechnicianIntelligenceProfile_evaluationCompletedById_fkey" FOREIGN KEY ("evaluationCompletedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TechnicianJobCategory" ADD CONSTRAINT "TechnicianJobCategory_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TechnicianJobCategoryMapping" ADD CONSTRAINT "TechnicianJobCategoryMapping_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TechnicianJobCategoryMapping" ADD CONSTRAINT "TechnicianJobCategoryMapping_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "TechnicianJobCategory"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TechnicianSkillDefinition" ADD CONSTRAINT "TechnicianSkillDefinition_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TechnicianSkillDefinition" ADD CONSTRAINT "TechnicianSkillDefinition_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "TechnicianJobCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TechnicianSkillRating" ADD CONSTRAINT "TechnicianSkillRating_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TechnicianSkillRating" ADD CONSTRAINT "TechnicianSkillRating_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "TechnicianIntelligenceProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TechnicianSkillRating" ADD CONSTRAINT "TechnicianSkillRating_skillId_fkey" FOREIGN KEY ("skillId") REFERENCES "TechnicianSkillDefinition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TechnicianQualificationDefinition" ADD CONSTRAINT "TechnicianQualificationDefinition_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TechnicianQualification" ADD CONSTRAINT "TechnicianQualification_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TechnicianQualification" ADD CONSTRAINT "TechnicianQualification_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "TechnicianIntelligenceProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TechnicianQualification" ADD CONSTRAINT "TechnicianQualification_definitionId_fkey" FOREIGN KEY ("definitionId") REFERENCES "TechnicianQualificationDefinition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TechnicianQualification" ADD CONSTRAINT "TechnicianQualification_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TechnicianJobTypeRequirement" ADD CONSTRAINT "TechnicianJobTypeRequirement_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TechnicianJobTypeRequirement" ADD CONSTRAINT "TechnicianJobTypeRequirement_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "TechnicianJobCategory"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TechnicianJobTypeRequirement" ADD CONSTRAINT "TechnicianJobTypeRequirement_qualificationDefinitionId_fkey" FOREIGN KEY ("qualificationDefinitionId") REFERENCES "TechnicianQualificationDefinition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TechnicianCallPreference" ADD CONSTRAINT "TechnicianCallPreference_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TechnicianCallPreference" ADD CONSTRAINT "TechnicianCallPreference_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "TechnicianIntelligenceProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TechnicianCallPreference" ADD CONSTRAINT "TechnicianCallPreference_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "TechnicianJobCategory"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TechnicianCallPreference" ADD CONSTRAINT "TechnicianCallPreference_changedById_fkey" FOREIGN KEY ("changedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TechnicianPerformanceAggregate" ADD CONSTRAINT "TechnicianPerformanceAggregate_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TechnicianPerformanceAggregate" ADD CONSTRAINT "TechnicianPerformanceAggregate_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "TechnicianIntelligenceProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TechnicianPerformanceAggregate" ADD CONSTRAINT "TechnicianPerformanceAggregate_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "TechnicianJobCategory"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TechnicianIntelligenceOverride" ADD CONSTRAINT "TechnicianIntelligenceOverride_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TechnicianIntelligenceOverride" ADD CONSTRAINT "TechnicianIntelligenceOverride_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "TechnicianIntelligenceProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TechnicianIntelligenceOverride" ADD CONSTRAINT "TechnicianIntelligenceOverride_changedById_fkey" FOREIGN KEY ("changedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TechnicianJobRelationship" ADD CONSTRAINT "TechnicianJobRelationship_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TechnicianJobRelationship" ADD CONSTRAINT "TechnicianJobRelationship_originalJobId_fkey" FOREIGN KEY ("originalJobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TechnicianJobRelationship" ADD CONSTRAINT "TechnicianJobRelationship_relatedJobId_fkey" FOREIGN KEY ("relatedJobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "TechnicianSkillRating"
  ADD CONSTRAINT "TechnicianSkillRating_rating_check" CHECK ("rating" BETWEEN 1 AND 5);

ALTER TABLE "TechnicianJobRelationship"
  ADD CONSTRAINT "TechnicianJobRelationship_distinct_jobs_check" CHECK ("originalJobId" <> "relatedJobId");

-- Configuration only: HVAC tenants receive editable starter definitions.
-- No ratings, qualifications, preferences, or performance data are fabricated.
WITH categories(key, name, aliases, sort_order) AS (
  VALUES
    ('NO_COOLING', 'No Cooling', ARRAY['NO COOL','AC NOT COOLING','COOLING PROBLEM'], 10),
    ('NO_HEATING', 'No Heating', ARRAY['NO HEAT','HEATING PROBLEM'], 20),
    ('HEAT_PUMP', 'Heat Pump Diagnostics', ARRAY['HEAT PUMP'], 30),
    ('GAS_FURNACE', 'Gas Furnace Diagnostics', ARRAY['GAS FURNACE'], 40),
    ('ELECTRICAL', 'Electrical Diagnostics', ARRAY['ELECTRICAL'], 50),
    ('REFRIGERATION', 'Refrigeration Diagnostics', ARRAY['REFRIGERATION'], 60),
    ('CONTROLS', 'Controls / Thermostats', ARRAY['THERMOSTAT','CONTROLS'], 70),
    ('AIRFLOW_DUCT', 'Airflow / Duct Diagnostics', ARRAY['AIRFLOW','DUCT'], 80),
    ('IAQ', 'Indoor Air Quality', ARRAY['IAQ','INDOOR AIR QUALITY'], 90),
    ('MAINTENANCE', 'Maintenance', ARRAY['TUNE UP','TUNE-UP','PM'], 100),
    ('COMMERCIAL', 'Commercial Service', ARRAY['COMMERCIAL'], 110),
    ('INSTALL', 'Install / Changeout', ARRAY['INSTALL','CHANGEOUT','REPLACEMENT'], 120),
    ('OTHER', 'Other', ARRAY[]::TEXT[], 999)
)
INSERT INTO "TechnicianJobCategory" (
  "id", "companyId", "key", "name", "aliases", "sortOrder", "updatedAt"
)
SELECT
  'ticat_' || substr(md5(c.id || categories.key), 1, 20),
  c.id,
  categories.key,
  categories.name,
  categories.aliases,
  categories.sort_order,
  CURRENT_TIMESTAMP
FROM "Company" c
CROSS JOIN categories
WHERE c."industry" = 'HVAC'
ON CONFLICT ("companyId", "key") DO NOTHING;

WITH skills(key, name, skill_group, category_key, sort_order) AS (
  VALUES
    ('NO_COOLING', 'No Cooling', 'SERVICE', 'NO_COOLING', 10),
    ('NO_HEATING', 'No Heating', 'SERVICE', 'NO_HEATING', 20),
    ('HEAT_PUMP_DIAGNOSTICS', 'Heat Pump Diagnostics', 'SERVICE', 'HEAT_PUMP', 30),
    ('GAS_FURNACE_DIAGNOSTICS', 'Gas Furnace Diagnostics', 'SERVICE', 'GAS_FURNACE', 40),
    ('ELECTRICAL_DIAGNOSTICS', 'Electrical Diagnostics', 'SERVICE', 'ELECTRICAL', 50),
    ('REFRIGERATION_DIAGNOSTICS', 'Refrigeration Diagnostics', 'SERVICE', 'REFRIGERATION', 60),
    ('CONTROLS_THERMOSTATS', 'Controls / Thermostats', 'SERVICE', 'CONTROLS', 70),
    ('AIRFLOW_DUCT_DIAGNOSTICS', 'Airflow / Duct Diagnostics', 'SERVICE', 'AIRFLOW_DUCT', 80),
    ('IAQ', 'Indoor Air Quality', 'SERVICE', 'IAQ', 90),
    ('MAINTENANCE', 'Maintenance', 'SERVICE', 'MAINTENANCE', 100),
    ('COMMERCIAL_SERVICE', 'Commercial Service', 'SERVICE', 'COMMERCIAL', 110),
    ('OPTIONS_PRESENTATION', 'Options Presentation', 'OPPORTUNITY', NULL, 120),
    ('REPLACEMENT_OPPORTUNITIES', 'Replacement Opportunities', 'OPPORTUNITY', 'INSTALL', 130),
    ('MEMBERSHIPS', 'Memberships', 'OPPORTUNITY', 'MAINTENANCE', 140),
    ('IAQ_OPPORTUNITIES', 'IAQ Opportunities', 'OPPORTUNITY', 'IAQ', 150),
    ('CHANGEOUT_REPLACEMENT', 'Changeout / Replacement', 'INSTALL', 'INSTALL', 160),
    ('STARTUP_COMMISSIONING', 'Startup / Commissioning', 'INSTALL', 'INSTALL', 170),
    ('DUCTWORK', 'Ductwork', 'INSTALL', 'AIRFLOW_DUCT', 180),
    ('NEW_CONSTRUCTION', 'New Construction', 'INSTALL', 'INSTALL', 190),
    ('PUNCH_WARRANTY', 'Punch / Warranty', 'INSTALL', 'INSTALL', 200)
)
INSERT INTO "TechnicianSkillDefinition" (
  "id", "companyId", "categoryId", "key", "name", "group", "sortOrder", "updatedAt"
)
SELECT
  'tisk_' || substr(md5(c.id || skills.key), 1, 20),
  c.id,
  cat.id,
  skills.key,
  skills.name,
  skills.skill_group,
  skills.sort_order,
  CURRENT_TIMESTAMP
FROM "Company" c
CROSS JOIN skills
LEFT JOIN "TechnicianJobCategory" cat
  ON cat."companyId" = c.id AND cat."key" = skills.category_key
WHERE c."industry" = 'HVAC'
ON CONFLICT ("companyId", "key") DO NOTHING;

WITH qualifications(key, name, sort_order) AS (
  VALUES
    ('EPA_UNIVERSAL', 'EPA Universal', 10),
    ('EPA_TYPE_I', 'EPA Type I', 20),
    ('EPA_TYPE_II', 'EPA Type II', 30),
    ('EPA_TYPE_III', 'EPA Type III', 40),
    ('GAS_EQUIPMENT', 'Gas Equipment', 50),
    ('HEAT_PUMP', 'Heat Pump', 60),
    ('COMMERCIAL', 'Commercial', 70),
    ('ELECTRICAL_DIAGNOSTICS', 'Electrical Diagnostics', 80),
    ('MANUFACTURER_CERTIFICATION', 'Manufacturer Certification', 90),
    ('OTHER', 'Other', 999)
)
INSERT INTO "TechnicianQualificationDefinition" (
  "id", "companyId", "key", "name", "sortOrder", "updatedAt"
)
SELECT
  'tiqual_' || substr(md5(c.id || qualifications.key), 1, 20),
  c.id,
  qualifications.key,
  qualifications.name,
  qualifications.sort_order,
  CURRENT_TIMESTAMP
FROM "Company" c
CROSS JOIN qualifications
WHERE c."industry" = 'HVAC'
ON CONFLICT ("companyId", "key") DO NOTHING;
