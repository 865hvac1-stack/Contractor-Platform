import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/tenant";
import { AuthError } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { createOAuthState } from "@/lib/integrations/oauth/state";
import { upsertConnection } from "@/lib/integrations/store";
import { loadQuickBooksAppCredentials } from "@/lib/quickbooks/app";
import { QUICKBOOKS_PROVIDER_KEY } from "@/lib/quickbooks/config";
import { createQuickBooksState, quickbooksAuthorizeHref } from "@/lib/quickbooks/oauth";
import {
  PRODUCTION_QUICKBOOKS_CALLBACK_URI,
  assertQuickBooksRedirectUriSafe,
  quickbooksBrowserRedirect,
  quickbooksRedirectUri,
} from "@/lib/quickbooks/public-url";

export async function GET(request: Request) {
  try {
    const ctx = await requirePermission("accounting:manage");
    const app = await loadQuickBooksAppCredentials(prisma, ctx.company.id);
    if (!app) {
      return NextResponse.redirect(quickbooksBrowserRedirect("/settings/quickbooks?error=missing_credentials", request));
    }
    const redirectUri = quickbooksRedirectUri(request);
    const safe = assertQuickBooksRedirectUriSafe(redirectUri);
    if (!safe.ok) {
      return NextResponse.redirect(
        quickbooksBrowserRedirect(`/settings/quickbooks?error=${encodeURIComponent(safe.error)}`, request)
      );
    }
    const state = createQuickBooksState();
    await createOAuthState({
      companyId: ctx.company.id,
      userId: ctx.user.id,
      providerKey: QUICKBOOKS_PROVIDER_KEY,
      state,
      redirectTo: "/settings/quickbooks/setup",
    });
    await upsertConnection({
      companyId: ctx.company.id,
      providerKey: QUICKBOOKS_PROVIDER_KEY,
      status: "CONNECTING",
      healthMessage: "Waiting for QuickBooks authorization.",
    });
    console.info(
      JSON.stringify({
        event: "QUICKBOOKS_OAUTH_START",
        companyId: ctx.company.id,
        redirectMatchesProduction: redirectUri === PRODUCTION_QUICKBOOKS_CALLBACK_URI,
        redirectHost: new URL(redirectUri).host,
      })
    );
    return NextResponse.redirect(quickbooksAuthorizeHref(state, app));
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.redirect(quickbooksBrowserRedirect("/login?next=/settings/quickbooks", request));
    }
    throw error;
  }
}
