import { NextResponse } from "next/server";
import { exchangeLinkedInCode } from "@/lib/integrations/oauth/linkedin";
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
      new URL("/marketing/channels?error=LinkedIn+authorization+expired.+Start+again", url.origin)
    );
  }
  try {
    const tokens = await exchangeLinkedInCode(code);
    const result = await finishOAuth({
      companyId: row.companyId,
      userId: row.userId,
      providerKey: row.providerKey,
      tokens,
      redirectTo: row.redirectTo,
    });
    return NextResponse.redirect(new URL(result.redirectTo, url.origin));
  } catch (e) {
    const message = e instanceof Error ? e.message : "LinkedIn authorization failed.";
    return NextResponse.redirect(
      new URL(`/marketing/channels/linkedin?error=${encodeURIComponent(message)}`, url.origin)
    );
  }
}
