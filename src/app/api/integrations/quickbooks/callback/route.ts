import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { consumeOAuthState } from "@/lib/integrations/oauth/state";
import { saveConnectionTokens, upsertConnection } from "@/lib/integrations/store";
import { writeAudit } from "@/lib/audit";
import { loadQuickBooksAppCredentials } from "@/lib/quickbooks/app";
import { QUICKBOOKS_PROVIDER_KEY } from "@/lib/quickbooks/config";
import { exchangeQuickBooksCode } from "@/lib/quickbooks/oauth";
import { verifyQuickBooksCompany } from "@/lib/quickbooks/verify";
import { quickbooksBrowserRedirect, quickbooksPostOAuthPath } from "@/lib/quickbooks/public-url";

function toApp(path: string, request: Request) {
  return NextResponse.redirect(quickbooksBrowserRedirect(path, request));
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const error = url.searchParams.get("error");
  const code = url.searchParams.get("code");
  const realmId = url.searchParams.get("realmId") || url.searchParams.get("realmID");
  const state = url.searchParams.get("state") || "";
  if (error) {
    return toApp(quickbooksPostOAuthPath({ error }), request);
  }
  const row = await consumeOAuthState(state);
  if (!row || !code || row.providerKey !== QUICKBOOKS_PROVIDER_KEY) {
    return toApp(quickbooksPostOAuthPath({ error: "Authorization expired. Start again." }), request);
  }
  if (!realmId) {
    await upsertConnection({
      companyId: row.companyId,
      providerKey: QUICKBOOKS_PROVIDER_KEY,
      status: "ERROR",
      errorMessage: "QuickBooks did not return a company id.",
    });
    return toApp(quickbooksPostOAuthPath({ error: "QuickBooks did not return a company id." }), request);
  }
  try {
    const app = await loadQuickBooksAppCredentials(prisma, row.companyId);
    const tokens = await exchangeQuickBooksCode(code, app);
    const connection = await upsertConnection({
      companyId: row.companyId,
      providerKey: QUICKBOOKS_PROVIDER_KEY,
      status: "CONNECTED",
      externalAccountId: realmId,
      accountLabel: null,
      scopes: tokens.scopes ?? [],
      healthMessage: "Connected. Verifying QuickBooks company.",
      errorMessage: null,
    });
    await saveConnectionTokens({
      companyId: row.companyId,
      connectionId: connection.id,
      tokens,
    });
    const verified = await verifyQuickBooksCompany(prisma, row.companyId);
    await writeAudit({
      companyId: row.companyId,
      actorId: row.userId,
      action: "quickbooks.connected",
      entityType: "IntegrationConnection",
      entityId: connection.id,
      metadata: { realmPresent: true, verified: verified.ok },
    });
    const settings = await prisma.quickBooksSettings.findUnique({ where: { companyId: row.companyId } });
    return toApp(
      quickbooksPostOAuthPath({ connected: true, wizardCompleted: Boolean(settings?.wizardCompletedAt) }),
      request
    );
  } catch {
    await upsertConnection({
      companyId: row.companyId,
      providerKey: QUICKBOOKS_PROVIDER_KEY,
      status: "REAUTH_REQUIRED",
      errorMessage: "QuickBooks authorization failed. Connect again.",
    });
    return toApp(quickbooksPostOAuthPath({ error: "QuickBooks authorization failed." }), request);
  }
}
