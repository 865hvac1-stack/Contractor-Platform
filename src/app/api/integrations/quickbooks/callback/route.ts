import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { consumeOAuthState } from "@/lib/integrations/oauth/state";
import { saveConnectionTokens, upsertConnection } from "@/lib/integrations/store";
import { writeAudit } from "@/lib/audit";
import { loadQuickBooksAppCredentials } from "@/lib/quickbooks/app";
import { QUICKBOOKS_PROVIDER_KEY } from "@/lib/quickbooks/config";
import { exchangeQuickBooksCode } from "@/lib/quickbooks/oauth";
import { verifyQuickBooksCompany } from "@/lib/quickbooks/verify";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const error = url.searchParams.get("error");
  const code = url.searchParams.get("code");
  const realmId = url.searchParams.get("realmId") || url.searchParams.get("realmID");
  const state = url.searchParams.get("state") || "";
  if (error) {
    return NextResponse.redirect(new URL(`/settings/quickbooks?error=${encodeURIComponent(error)}`, url.origin));
  }
  const row = await consumeOAuthState(state);
  if (!row || !code || row.providerKey !== QUICKBOOKS_PROVIDER_KEY) {
    return NextResponse.redirect(new URL("/settings/quickbooks?error=Authorization+expired.+Start+again.", url.origin));
  }
  if (!realmId) {
    await upsertConnection({
      companyId: row.companyId,
      providerKey: QUICKBOOKS_PROVIDER_KEY,
      status: "ERROR",
      errorMessage: "QuickBooks did not return a company id.",
    });
    return NextResponse.redirect(new URL("/settings/quickbooks?error=QuickBooks+did+not+return+a+company+id.", url.origin));
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
    if (!settings?.wizardCompletedAt) {
      return NextResponse.redirect(new URL("/settings/quickbooks/setup", url.origin));
    }
    return NextResponse.redirect(new URL("/settings/quickbooks?connected=1", url.origin));
  } catch {
    await upsertConnection({
      companyId: row.companyId,
      providerKey: QUICKBOOKS_PROVIDER_KEY,
      status: "REAUTH_REQUIRED",
      errorMessage: "QuickBooks authorization failed. Connect again.",
    });
    return NextResponse.redirect(new URL("/settings/quickbooks?error=QuickBooks+authorization+failed.", url.origin));
  }
}
