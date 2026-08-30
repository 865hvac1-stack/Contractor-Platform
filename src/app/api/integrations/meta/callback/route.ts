import { NextResponse } from "next/server";
import { exchangeMetaCode } from "@/lib/integrations/oauth/meta";
import { consumeOAuthState } from "@/lib/integrations/oauth/state";
import { finishOAuth } from "@/lib/integrations/oauth/finish";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const error = url.searchParams.get("error_description") || url.searchParams.get("error");
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state") || "";
  if (error) {
    return NextResponse.redirect(
      new URL(`/marketing/channels?error=${encodeURIComponent(error)}`, url.origin)
    );
  }
  const row = await consumeOAuthState(state);
  if (!row || !code) {
    return NextResponse.redirect(
      new URL("/marketing/channels?error=Meta+authorization+expired.+Start+again", url.origin)
    );
  }
  try {
    const tokens = await exchangeMetaCode(code);
    const result = await finishOAuth({
      companyId: row.companyId,
      userId: row.userId,
      providerKey: row.providerKey,
      tokens,
      redirectTo: row.redirectTo,
    });
    return NextResponse.redirect(new URL(result.redirectTo, url.origin));
  } catch (e) {
    const message = e instanceof Error ? e.message : "Meta authorization failed.";
    return NextResponse.redirect(
      new URL(`/marketing/channels/${row.providerKey}?error=${encodeURIComponent(message)}`, url.origin)
    );
  }
}
