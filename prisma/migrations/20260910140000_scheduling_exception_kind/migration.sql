-- Preserve existing overrides. kind is optional metadata for the Scheduling & Capacity editor.
ALTER TABLE "AvailabilityOverride" ADD COLUMN IF NOT EXISTS "kind" TEXT;
