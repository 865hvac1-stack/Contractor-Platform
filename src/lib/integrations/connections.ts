import type { IntegrationStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { INTEGRATION_PROVIDERS } from "@/lib/integrations/catalog";
import { scopedCompanyWhere } from "@/lib/intelligence/scope";

export type PublicConnection = {
  providerKey: string;
  status: IntegrationStatus;
  accountLabel: string | null;
  lastSyncAt: Date | null;
  healthMessage: string | null;
  errorMessage: string | null;
};

/** Safe for the browser: no tokens, ciphertext, or scopes secrets. */
export async function listPublicConnections(companyId: string): Promise<PublicConnection[]> {
  const rows = await prisma.integrationConnection.findMany({
    where: scopedCompanyWhere(companyId),
    select: {
      providerKey: true,
      status: true,
      accountLabel: true,
      lastSyncAt: true,
      healthMessage: true,
      errorMessage: true,
    },
  });
  return rows;
}

export async function getChannelCards(companyId: string) {
  const connections = await listPublicConnections(companyId);
  const byKey = new Map(connections.map((c) => [c.providerKey, c]));

  return INTEGRATION_PROVIDERS.map((provider) => {
    const connection = byKey.get(provider.key);
    return {
      provider,
      status: connection?.status ?? ("NOT_CONNECTED" as const),
      accountLabel: connection?.accountLabel ?? null,
      lastSyncAt: connection?.lastSyncAt ?? null,
      healthMessage: connection?.healthMessage ?? null,
      errorMessage: connection?.errorMessage ?? null,
    };
  });
}
