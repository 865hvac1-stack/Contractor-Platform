import { prisma } from "@/lib/db";
import { getCompanyConnection, getValidAccessToken } from "@/lib/integrations/store";
import { liveQboTransport, type QboTransport } from "@/lib/quickbooks/client";
import { loadQuickBooksAppCredentials } from "@/lib/quickbooks/app";
import { QUICKBOOKS_PROVIDER_KEY } from "@/lib/quickbooks/config";
import { normalizedQuickBooksEnvironment, type QuickBooksScope } from "@/lib/quickbooks/ownership";

export async function loadQuickBooksTransport(companyId: string): Promise<
  | { ok: true; transport: QboTransport; connectionId: string; realmId: string; environment: "sandbox" | "production"; scope: QuickBooksScope }
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
  const environment = normalizedQuickBooksEnvironment(connection.environment);
  if (!environment) {
    return { ok: false, error: "QuickBooks connection environment is missing. Reconnect before continuing." };
  }
  const app = await loadQuickBooksAppCredentials(prisma, companyId);
  if (!app || app.environment !== environment) {
    return {
      ok: false,
      error: "QuickBooks connection environment does not match the configured Intuit app. Reconnect before continuing.",
    };
  }
  const tokens = await getValidAccessToken({
    companyId,
    connectionId: connection.id,
    providerKey: QUICKBOOKS_PROVIDER_KEY,
  });
  if (!tokens) {
    return { ok: false, error: "Reconnect QuickBooks. Authorization expired.", reauth: true };
  }
  const scope = { companyId, environment, realmId: connection.externalAccountId };
  return {
    ok: true,
    transport: liveQboTransport({
      accessToken: tokens.accessToken,
      realmId: connection.externalAccountId,
      environment,
      companyId,
    }),
    connectionId: connection.id,
    realmId: connection.externalAccountId,
    environment,
    scope,
  };
}

export async function getQuickBooksSettings(companyId: string) {
  return prisma.quickBooksSettings.upsert({
    where: { companyId },
    create: { companyId, invoiceSyncTrigger: "MANUAL_ONLY" },
    update: {},
  });
}
