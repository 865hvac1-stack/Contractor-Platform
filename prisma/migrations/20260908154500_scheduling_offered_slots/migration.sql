-- Persist offered appointment choices so the customer can pick "the first one" / Tuesday
-- without ContractorYou asking "What day works best?" again.
ALTER TABLE "ConversationSchedulingState" ADD COLUMN "offeredSlots" JSONB;
