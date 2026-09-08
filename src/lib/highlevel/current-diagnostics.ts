import type { PrismaClient } from "@prisma/client";
import { diagnosticAppliesToCanonicalLocation } from "@/lib/highlevel/canonical-connection";
import {
  diagnoseHighLevelConversationsApi,
  type HighLevelConversationsDiagnostic,
} from "@/lib/highlevel/conversations-diagnostic";
import {
  diagnoseHighLevelTokenType,
  type HighLevelTokenTypeDiagnostic,
} from "@/lib/highlevel/token-type-diagnostic";

export async function ensureCurrentHighLevelDiagnostics(
  prisma: PrismaClient,
  companyId: string,
  input: {
    connectionId: string;
    canonicalLocationId: string;
    connected: boolean;
    lastConversations?: { summary: unknown } | null;
    lastTokenType?: { summary: unknown } | null;
  }
): Promise<{
  conversations: HighLevelConversationsDiagnostic | null;
  tokenType: HighLevelTokenTypeDiagnostic | null;
}> {
  let conversations = diagnosticAppliesToCanonicalLocation(
    input.lastConversations?.summary,
    input.canonicalLocationId
  )
    ? (input.lastConversations?.summary as HighLevelConversationsDiagnostic)
    : null;
  let tokenType = diagnosticAppliesToCanonicalLocation(input.lastTokenType?.summary, input.canonicalLocationId)
    ? (input.lastTokenType?.summary as HighLevelTokenTypeDiagnostic)
    : null;

  if (!input.connected) {
    return { conversations, tokenType };
  }

  if (!conversations) {
    try {
      const result = await diagnoseHighLevelConversationsApi(prisma, companyId);
      if (diagnosticAppliesToCanonicalLocation(result, input.canonicalLocationId)) {
        await prisma.integrationSync.create({
          data: {
            companyId,
            connectionId: input.connectionId,
            kind: "conversations_diagnostic",
            status: "COMPLETED",
            finishedAt: new Date(),
            summary: result as never,
          },
        });
        conversations = result;
      }
    } catch {
      conversations = null;
    }
  }

  if (!tokenType) {
    try {
      const result = await diagnoseHighLevelTokenType(prisma, companyId);
      if (diagnosticAppliesToCanonicalLocation(result, input.canonicalLocationId)) {
        await prisma.integrationSync.create({
          data: {
            companyId,
            connectionId: input.connectionId,
            kind: "token_type_diagnostic",
            status: "COMPLETED",
            finishedAt: new Date(),
            summary: result as never,
          },
        });
        tokenType = result;
      }
    } catch {
      tokenType = null;
    }
  }

  return { conversations, tokenType };
}
