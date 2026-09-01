import type { PrismaClient } from "@prisma/client";
import { HIGHLEVEL_PROVIDER_KEY, type HighLevelAuthMode } from "@/lib/highlevel/config";
import { getCompanyConnection, getValidAccessToken } from "@/lib/integrations/store";
import { fetchHighLevelLocation } from "@/lib/highlevel/client";

export async function getHighLevelConnection(prisma: PrismaClient, companyId: string) {
  return getCompanyConnection(companyId, HIGHLEVEL_PROVIDER_KEY);
}

export async function isHighLevelConnected(prisma: PrismaClient, companyId: string) {
  const connection = await getHighLevelConnection(prisma, companyId);
  return connection?.status === "CONNECTED" && Boolean(connection.externalAccountId);
}

export function highlevelAuthMode(scopes: string[]): HighLevelAuthMode {
  return scopes.includes("private_token") ? "private_token" : "oauth";
}

export async function loadHighLevelAccess(prisma: PrismaClient, companyId: string) {
  const connection = await getHighLevelConnection(prisma, companyId);
  if (!connection || connection.status !== "CONNECTED") return null;
  const tokens = await getValidAccessToken({
    companyId,
    connectionId: connection.id,
    providerKey: HIGHLEVEL_PROVIDER_KEY,
  });
  if (!tokens?.accessToken || !connection.externalAccountId) return null;
  return {
    connection,
    accessToken: tokens.accessToken,
    locationId: connection.externalAccountId,
    authMode: highlevelAuthMode(connection.scopes),
  };
}

export async function probeHighLevelLocation(accessToken: string, locationId: string) {
  try {
    const location = await fetchHighLevelLocation(accessToken, locationId);
    return { ok: true as const, location };
  } catch (error) {
    return {
      ok: false as const,
      error: error instanceof Error ? error.message : "HighLevel location probe failed.",
    };
  }
}
