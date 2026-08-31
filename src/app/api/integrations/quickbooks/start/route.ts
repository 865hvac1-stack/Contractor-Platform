import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/tenant";
import { AuthError } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { createOAuthState } from "@/lib/integrations/oauth/state";
import { upsertConnection } from "@/lib/integrations/store";
import { loadQuickBooksAppCredentials } from "@/lib/quickbooks/app";
import { QUICKBOOKS_PROVIDER_KEY } from "@/lib/quickbooks/config";
import { createQuickBooksState, quickbooksAuthorizeHref } from "@/lib/quickbooks/oauth";

function originOf(request: Request) {
  return new URL(request.url).origin;
}

export async function GET(request: Request) {
  try {
    const ctx = await requirePermission("accounting:manage");
    const app = await loadQuickBooksAppCredentials(prisma, ctx.company.id);
    if (!app) {
      return NextResponse.redirect(new URL("/settings/quickbooks?error=missing_credentials", originOf(request)));
    }
    const state = createQuickBooksState();
    await createOAuthState({
      companyId: ctx.company.id,
      userId: ctx.user.id,
      providerKey: QUICKBOOKS_PROVIDER_KEY,
      state,
      redirectTo: "/settings/quickbooks",
    });
    await upsertConnection({
      companyId: ctx.company.id,
      providerKey: QUICKBOOKS_PROVIDER_KEY,
      status: "CONNECTING",
      healthMessage: "Waiting for QuickBooks authorization.",
    });
    return NextResponse.redirect(quickbooksAuthorizeHref(state, app));
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.redirect(new URL("/login?next=/settings/quickbooks", originOf(request)));
    }
    throw error;
  }
}
