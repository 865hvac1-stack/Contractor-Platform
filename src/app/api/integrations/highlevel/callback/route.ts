import { NextResponse } from "next/server";
import { consumeOAuthState } from "@/lib/integrations/oauth/state";
import { HIGHLEVEL_PROVIDER_KEY } from "@/lib/highlevel/config";
import { exchangeHighLevelCode } from "@/lib/highlevel/oauth";
import { saveConnectionTokens, upsertConnection } from "@/lib/integrations/store";
import { writeAudit } from "@/lib/audit";
import { appUrl } from "@/lib/integrations/env";
import { upsertIdentityMap } from "@/lib/highlevel/identity";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const origin = appUrl();
  const error = url.searchParams.get("error");
  if (error) {
    return NextResponse.redirect(new URL(`/settings/highlevel?error=${encodeURIComponent(error)}`, origin));
  }
  const code = url.searchParams.get("code") ?? "";
  const state = url.searchParams.get("state") ?? "";
  const stored = await consumeOAuthState(state);
  if (!stored || stored.providerKey !== HIGHLEVEL_PROVIDER_KEY) {
    return NextResponse.redirect(new URL("/settings/highlevel?error=Authorization+expired.+Start+again.", origin));
  }
  try {
    const exchanged = await exchangeHighLevelCode(code);
    const locationId = exchanged.locationId || url.searchParams.get("locationId");
    if (!locationId) {
      return NextResponse.redirect(
        new URL("/settings/highlevel?error=HighLevel+did+not+return+a+location+id.", origin)
      );
    }
    const connection = await upsertConnection({
      companyId: stored.companyId,
      providerKey: HIGHLEVEL_PROVIDER_KEY,
      status: "CONNECTED",
      accountLabel: "HighLevel location",
      externalAccountId: locationId,
      scopes: exchanged.tokens.scopes ?? [],
      healthMessage: "Connected with Marketplace OAuth.",
      errorMessage: null,
    });
    await saveConnectionTokens({
      companyId: stored.companyId,
      connectionId: connection.id,
      tokens: exchanged.tokens,
    });
    await upsertIdentityMap(
      (await import("@/lib/db")).prisma,
      {
        companyId: stored.companyId,
        entityType: "COMPANY",
        internalId: stored.companyId,
        externalId: locationId,
        metadata: exchanged.agencyId ? { agencyId: exchanged.agencyId } : undefined,
      }
    );
    await writeAudit({
      companyId: stored.companyId,
      actorId: stored.userId,
      action: "highlevel.connected",
      entityType: "IntegrationConnection",
      entityId: connection.id,
      metadata: { mode: "oauth", locationId },
    });
    return NextResponse.redirect(new URL("/settings/highlevel?connected=1", origin));
  } catch {
    return NextResponse.redirect(new URL("/settings/highlevel?error=HighLevel+authorization+failed.", origin));
  }
}
