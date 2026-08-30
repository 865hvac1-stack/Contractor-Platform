import type { IntegrationStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { INTEGRATION_PROVIDERS, getProvider } from "@/lib/integrations/catalog";
import { getProviderEnv } from "@/lib/integrations/env";
import { scopedCompanyWhere } from "@/lib/intelligence/scope";

export type PublicConnection = {
  providerKey: string;
  status: IntegrationStatus;
  accountLabel: string | null;
  lastSyncAt: Date | null;
  lastAttemptAt: Date | null;
  healthMessage: string | null;
  errorMessage: string | null;
  scopes: string[];
};

export type ChannelAction =
  | "CONNECT"
  | "CONFIGURE_INTEGRATION"
  | "SELECT_ACCOUNT"
  | "SYNC_NOW"
  | "RECONNECT"
  | "DISCONNECT"
  | "MANAGE"
  | "COMING_SOON";

export async function listPublicConnections(companyId: string): Promise<PublicConnection[]> {
  const rows = await prisma.integrationConnection.findMany({
    where: scopedCompanyWhere(companyId),
    select: {
      providerKey: true,
      status: true,
      accountLabel: true,
      lastSyncAt: true,
      lastAttemptAt: true,
      healthMessage: true,
      errorMessage: true,
      scopes: true,
    },
  });
  return rows;
}

export function primaryAction(input: {
  internalLive: boolean;
  oauthReady: boolean;
  configured: boolean;
  comingSoon?: boolean;
  status: IntegrationStatus;
}): ChannelAction {
  if (input.comingSoon) return "COMING_SOON";
  if (input.status === "SELECT_ACCOUNT") return "SELECT_ACCOUNT";
  if (input.status === "REAUTH_REQUIRED") return "RECONNECT";
  if (input.status === "CONNECTED" || input.status === "SYNCING" || input.status === "ERROR") {
    return "SYNC_NOW";
  }
  if (input.internalLive) return "MANAGE";
  if (input.oauthReady && input.configured) return "CONNECT";
  if (input.oauthReady && !input.configured) return "CONFIGURE_INTEGRATION";
  if (!input.internalLive && !input.oauthReady) return "CONFIGURE_INTEGRATION";
  return "COMING_SOON";
}

export async function getChannelCards(companyId: string) {
  const connections = await listPublicConnections(companyId);
  const byKey = new Map(connections.map((c) => [c.providerKey, c]));

  return INTEGRATION_PROVIDERS.map((provider) => {
    const connection = byKey.get(provider.key);
    const env = getProviderEnv(provider.key);
    const status = connection?.status ?? ("NOT_CONNECTED" as const);
    return {
      provider,
      env,
      status,
      accountLabel: connection?.accountLabel ?? null,
      lastSyncAt: connection?.lastSyncAt ?? null,
      lastAttemptAt: connection?.lastAttemptAt ?? null,
      healthMessage: connection?.healthMessage ?? null,
      errorMessage: connection?.errorMessage ?? null,
      scopes: connection?.scopes ?? [],
      action: primaryAction({
        internalLive: provider.internalLive,
        oauthReady: provider.oauthReady,
        configured: env.configured,
        comingSoon: provider.comingSoon,
        status,
      }),
    };
  });
}

export function providerOrThrow(key: string) {
  const provider = getProvider(key);
  if (!provider) throw new Error("Unknown provider.");
  return provider;
}
