-- Persist the property and intake needed to finish conversational booking
-- without duplicating Customer/Property records inside session JSON.
ALTER TABLE "ConversationSchedulingState" ADD COLUMN "propertyId" TEXT;
ALTER TABLE "ConversationSchedulingState" ADD COLUMN "customerConcern" TEXT;
ALTER TABLE "ConversationSchedulingState" ADD COLUMN "intake" JSONB;
