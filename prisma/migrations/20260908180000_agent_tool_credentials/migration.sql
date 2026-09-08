-- Company-scoped HighLevel Agent Studio credentials and safe call diagnostics.
CREATE TABLE "AgentToolCredential" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT 'HighLevel Agent Studio',
    "keyPrefix" TEXT NOT NULL,
    "keyHash" TEXT NOT NULL,
    "lastFour" TEXT NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "lastUsedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentToolCredential_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AgentToolCall" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "credentialId" TEXT,
    "tool" TEXT NOT NULL,
    "success" BOOLEAN NOT NULL,
    "errorCode" TEXT,
    "httpStatus" INTEGER NOT NULL,
    "locationId" TEXT,
    "contactId" TEXT,
    "conversationId" TEXT,
    "customerId" TEXT,
    "propertyId" TEXT,
    "serviceTypeId" TEXT,
    "jobId" TEXT,
    "bookingId" TEXT,
    "durationMs" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentToolCall_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AgentToolCredential_companyId_revokedAt_idx" ON "AgentToolCredential"("companyId", "revokedAt");
CREATE INDEX "AgentToolCredential_keyPrefix_idx" ON "AgentToolCredential"("keyPrefix");
CREATE INDEX "AgentToolCall_companyId_createdAt_idx" ON "AgentToolCall"("companyId", "createdAt");
CREATE INDEX "AgentToolCall_companyId_tool_createdAt_idx" ON "AgentToolCall"("companyId", "tool", "createdAt");

ALTER TABLE "AgentToolCredential" ADD CONSTRAINT "AgentToolCredential_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AgentToolCall" ADD CONSTRAINT "AgentToolCall_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AgentToolCall" ADD CONSTRAINT "AgentToolCall_credentialId_fkey" FOREIGN KEY ("credentialId") REFERENCES "AgentToolCredential"("id") ON DELETE SET NULL ON UPDATE CASCADE;
