import { NextResponse } from "next/server";
import { AuthError } from "@/lib/auth";
import { requirePermission } from "@/lib/tenant";
import { highlevelOAuthConfigured } from "@/lib/highlevel/env";
import { highlevelAuthorizeUrl } from "@/lib/highlevel/oauth";
import { HIGHLEVEL_PROVIDER_KEY } from "@/lib/highlevel/config";
import { createOAuthState } from "@/lib/integrations/oauth/state";
import { upsertConnection } from "@/lib/integrations/store";

export async function GET() {
  try {
    const ctx = await requirePermission("marketing:manage");
    const { refuseDemoExternal } = await import("@/lib/demo/guard");
    const demo = await refuseDemoExternal(ctx.company.id);
    if (demo) {
      return NextResponse.redirect(
        new URL("/settings/highlevel?error=demo_blocked", process.env.APP_URL || "http://127.0.0.1:43123")
      );
    }
    if (!highlevelOAuthConfigured()) {
      return NextResponse.redirect(new URL("/settings/highlevel?error=oauth_not_configured", process.env.APP_URL || "http://127.0.0.1:43123"));
    }
    const state = await createOAuthState({
      companyId: ctx.company.id,
      userId: ctx.user.id,
      providerKey: HIGHLEVEL_PROVIDER_KEY,
      redirectTo: "/settings/highlevel",
    });
    await upsertConnection({
      companyId: ctx.company.id,
      providerKey: HIGHLEVEL_PROVIDER_KEY,
      status: "CONNECTING",
      healthMessage: "Waiting for HighLevel Marketplace authorization.",
    });
    return NextResponse.redirect(highlevelAuthorizeUrl(state.state));
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.redirect(new URL("/login?next=/settings/highlevel", process.env.APP_URL || "http://127.0.0.1:43123"));
    }
    throw error;
  }
}
