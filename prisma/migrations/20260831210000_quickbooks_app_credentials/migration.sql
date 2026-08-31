-- Optional company-owned Intuit app credentials (encrypted secret).
-- Env vars still work when these are empty.
ALTER TABLE "QuickBooksSettings" ADD COLUMN "appClientId" TEXT;
ALTER TABLE "QuickBooksSettings" ADD COLUMN "appSecretCipher" BYTEA;
ALTER TABLE "QuickBooksSettings" ADD COLUMN "appSecretIv" BYTEA;
ALTER TABLE "QuickBooksSettings" ADD COLUMN "appSecretAuthTag" BYTEA;
ALTER TABLE "QuickBooksSettings" ADD COLUMN "appSecretKeyVersion" INTEGER;
ALTER TABLE "QuickBooksSettings" ADD COLUMN "appEnvironment" TEXT;
