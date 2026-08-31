import { prisma } from "@/lib/db";
import { getCompanyConnection, getValidAccessToken } from "@/lib/integrations/store";
import { liveQboTransport, type QboTransport } from "@/lib/quickbooks/client";
import { QUICKBOOKS_PROVIDER_KEY } from "@/lib/quickbooks/config";

export async function loadQuickBooksTransport(companyId: string): Promise<
  | { ok: true; transport: QboTransport; connectionId: string; realmId: string }
  | { ok: false; error: string; reauth?: boolean }
> {
  const connection = await getCompanyConnection(companyId, QUICKBOOKS_PROVIDER_KEY);
  if (!connection || connection.status === "NOT_CONNECTED") {
    return { ok: false, error: "Connect QuickBooks to sync invoices." };
  }
  if (connection.status === "REAUTH_REQUIRED") {
    return { ok: false, error: "Reconnect QuickBooks. Authorization expired.", reauth: true };
  }
  if (!connection.externalAccountId) {
    return { ok: false, error: "QuickBooks company id is missing. Reconnect." };
  }
  const tokens = await getValidAccessToken({
    companyId,
    connectionId: connection.id,
    providerKey: QUICKBOOKS_PROVIDER_KEY,
  });
  if (!tokens) {
    return { ok: false, error: "Reconnect QuickBooks. Authorization expired.", reauth: true };
  }
  return {
    ok: true,
    transport: liveQboTransport({ accessToken: tokens.accessToken, realmId: connection.externalAccountId }),
    connectionId: connection.id,
    realmId: connection.externalAccountId,
  };
}

export async function getQuickBooksSettings(companyId: string) {
  return prisma.quickBooksSettings.upsert({
    where: { companyId },
    create: { companyId, invoiceSyncTrigger: "MANUAL_ONLY" },
    update: {},
  });
}
