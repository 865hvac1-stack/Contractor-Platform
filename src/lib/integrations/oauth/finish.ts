import { prisma } from "@/lib/db";
import { saveConnectionTokens, upsertConnection } from "@/lib/integrations/store";
import { listProviderAccounts } from "@/lib/integrations/accounts";
import { writeAudit } from "@/lib/audit";
import type { ProviderTokenPayload } from "@/lib/integrations/crypto";

export async function finishOAuth(input: {
  companyId: string;
  userId: string;
  providerKey: string;
  tokens: ProviderTokenPayload;
  redirectTo?: string | null;
}) {
  const connection = await upsertConnection({
    companyId: input.companyId,
    providerKey: input.providerKey,
    status: "SELECT_ACCOUNT",
    scopes: input.tokens.scopes ?? [],
    healthMessage: "Authorized. Select the account ContractorYou should use.",
    errorMessage: null,
  });

  await saveConnectionTokens({
    companyId: input.companyId,
    connectionId: connection.id,
    tokens: input.tokens,
  });

  const listed = await listProviderAccounts(input.providerKey, input.tokens.accessToken);
  for (const account of listed.accounts) {
    await prisma.integrationAccount.upsert({
      where: {
        connectionId_kind_externalId: {
          connectionId: connection.id,
          kind: account.kind,
          externalId: account.id,
        },
      },
      create: {
        companyId: input.companyId,
        connectionId: connection.id,
        providerKey: input.providerKey,
        kind: account.kind,
        externalId: account.id,
        name: account.name,
      },
      update: { name: account.name },
    });
  }

  if (listed.error && listed.accounts.length === 0) {
    await upsertConnection({
      companyId: input.companyId,
      providerKey: input.providerKey,
      status: "ERROR",
      errorMessage: listed.error,
      healthMessage: listed.error,
    });
  }

  await writeAudit({
    companyId: input.companyId,
    actorId: input.userId,
    action: "integration.connected",
    entityType: "IntegrationConnection",
    entityId: connection.id,
    metadata: { providerKey: input.providerKey },
  });

  return {
    ok: true as const,
    redirectTo: input.redirectTo || `/marketing/channels/${input.providerKey}`,
  };
}
