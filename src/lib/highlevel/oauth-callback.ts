import { NextResponse } from "next/server";
import { consumeOAuthStateDetailed } from "@/lib/integrations/oauth/state";
import { HIGHLEVEL_PROVIDER_KEY } from "@/lib/highlevel/config";
import { exchangeHighLevelCode } from "@/lib/highlevel/oauth";
import { saveConnectionTokens, upsertConnection } from "@/lib/integrations/store";
import { writeAudit } from "@/lib/audit";
import { appUrl } from "@/lib/integrations/env";
import { upsertIdentityMap } from "@/lib/highlevel/identity";
import { highlevelRedirectUri } from "@/lib/highlevel/env";
import { logHighLevelOAuth } from "@/lib/highlevel/oauth-log";
import { MARKETPLACE_OAUTH_CALLBACK_PATH } from "@/lib/integrations/env";

const START_FROM_CONTRACTORYOU =
  "Start HighLevel from ContractorYou Settings. Click Connect HighLevel from the company that should own this location. A HighLevel Marketplace install link cannot create ContractorYou authorization state.";

function settingsRedirect(origin: string, query: string) {
  return NextResponse.redirect(new URL(`/settings/highlevel?${query}`, origin));
}

function redirectUriParts() {
  try {
    const uri = new URL(highlevelRedirectUri());
    return { host: uri.host, path: uri.pathname };
  } catch {
    return { host: null, path: null };
  }
}

/** Marketplace OAuth authorization-code callback. Used by /api/integrations/oauth/callback. */
export async function handleHighLevelMarketplaceCallback(request: Request) {
  const url = new URL(request.url);
  const origin = appUrl();
  const error = url.searchParams.get("error");
  if (error) {
    logHighLevelOAuth({ reason: "OAUTH_EXCHANGE_FAILED", error, hasCode: false, hasState: false });
    return settingsRedirect(origin, `error=${encodeURIComponent(error)}`);
  }
  const code = url.searchParams.get("code") ?? "";
  const state = url.searchParams.get("state") ?? "";
  const uri = redirectUriParts();
  if (uri.path && uri.path !== MARKETPLACE_OAUTH_CALLBACK_PATH) {
    logHighLevelOAuth({
      reason: "OAUTH_REDIRECT_URI_MISMATCH",
      hasCode: Boolean(code),
      hasState: Boolean(state),
      redirectUriHost: uri.host,
      redirectUriPath: uri.path,
    });
  }

  const stored = await consumeOAuthStateDetailed(state, HIGHLEVEL_PROVIDER_KEY);
  if (!stored.ok) {
    logHighLevelOAuth({
      reason: stored.reason,
      hasCode: Boolean(code),
      hasState: Boolean(state),
      redirectUriHost: uri.host,
      redirectUriPath: uri.path,
    });
    if (stored.reason === "OAUTH_STATE_MISSING") {
      return settingsRedirect(origin, `error=${encodeURIComponent(START_FROM_CONTRACTORYOU)}`);
    }
    return settingsRedirect(origin, "error=Authorization+expired.+Start+again.");
  }
  if (!code) {
    logHighLevelOAuth({
      reason: "OAUTH_CODE_MISSING",
      companyId: stored.row.companyId,
      userId: stored.row.userId,
      hasState: true,
      hasCode: false,
    });
    return settingsRedirect(origin, "error=Authorization+code+missing.");
  }
  try {
    const exchanged = await exchangeHighLevelCode(code);
    const locationId = exchanged.locationId || url.searchParams.get("locationId");
    if (!locationId) {
      logHighLevelOAuth({
        reason: "LOCATION_ID_MISSING",
        companyId: stored.row.companyId,
        userId: stored.row.userId,
        hasCode: true,
        hasState: true,
      });
      return settingsRedirect(origin, "error=HighLevel+did+not+return+a+location+id.");
    }
    const { assertHighLevelLocationAvailable } = await import("@/lib/highlevel/phone-numbers");
    const { prisma } = await import("@/lib/db");
    const { companyAllowsExternalIntegrationTesting } = await import("@/lib/demo/guard");
    const { authorizeHighLevelTestGrant } = await import("@/lib/highlevel/test-grant");
    const { probeHighLevelLocation } = await import("@/lib/highlevel/connection");
    if (await companyAllowsExternalIntegrationTesting(stored.row.companyId, prisma)) {
      const grant = await authorizeHighLevelTestGrant(prisma, {
        tenantCompanyId: stored.row.companyId,
        actorId: stored.row.userId,
        locationId,
        scopes: exchanged.tokens.scopes ?? [],
      });
      if (!grant.ok) {
        logHighLevelOAuth({
          reason: "LOCATION_ALREADY_OWNED_BY_OTHER_COMPANY",
          companyId: stored.row.companyId,
          locationId,
          sandbox: true,
          error: grant.error,
        });
        return settingsRedirect(origin, `error=${encodeURIComponent(grant.error)}`);
      }
      logHighLevelOAuth({
        reason: "OAUTH_TEST_ONLY",
        companyId: stored.row.companyId,
        userId: stored.row.userId,
        locationId,
        sandbox: true,
      });
      return settingsRedirect(origin, "test_connected=1");
    }
    const locationLock = await assertHighLevelLocationAvailable(prisma, locationId, stored.row.companyId);
    if (!locationLock.ok) {
      logHighLevelOAuth({
        reason: "LOCATION_ALREADY_OWNED_BY_OTHER_COMPANY",
        companyId: stored.row.companyId,
        locationId,
      });
      return settingsRedirect(origin, `error=${encodeURIComponent(locationLock.error)}`);
    }
    const existing = await prisma.integrationConnection.findFirst({
      where: { companyId: stored.row.companyId, providerKey: HIGHLEVEL_PROVIDER_KEY },
    });
    const pitUpgrade =
      Boolean(existing?.scopes.includes("private_token")) &&
      (existing?.externalAccountId === locationId || !existing?.externalAccountId);

    const probe = await probeHighLevelLocation(exchanged.tokens.accessToken, locationId);
    const connection = await upsertConnection({
      companyId: stored.row.companyId,
      providerKey: HIGHLEVEL_PROVIDER_KEY,
      status: probe.ok ? "CONNECTED" : "ERROR",
      accountLabel: probe.ok
        ? probe.location.name || existing?.accountLabel || "HighLevel location"
        : existing?.accountLabel || "HighLevel location",
      externalAccountId: locationId,
      scopes: exchanged.tokens.scopes ?? [],
      healthMessage: probe.ok
        ? pitUpgrade
          ? "Marketplace OAuth upgraded the previous private-token connection."
          : "Connected with Marketplace OAuth."
        : probe.error,
      errorMessage: probe.ok ? null : probe.error,
    });
    await saveConnectionTokens({
      companyId: stored.row.companyId,
      connectionId: connection.id,
      tokens: exchanged.tokens,
    });
    await upsertIdentityMap(prisma, {
      companyId: stored.row.companyId,
      entityType: "COMPANY",
      internalId: stored.row.companyId,
      externalId: locationId,
      metadata: exchanged.agencyId ? { agencyId: exchanged.agencyId } : undefined,
    });
    await writeAudit({
      companyId: stored.row.companyId,
      actorId: stored.row.userId,
      action: pitUpgrade ? "highlevel.oauth_upgraded_from_pit" : "highlevel.connected",
      entityType: "IntegrationConnection",
      entityId: connection.id,
      metadata: {
        mode: "oauth",
        locationId,
        pitUpgrade,
        verified: probe.ok,
      },
    });
    logHighLevelOAuth({
      reason: probe.ok
        ? pitUpgrade
          ? "LOCATION_SAME_COMPANY_PIT_UPGRADE"
          : "OAUTH_CONNECTED"
        : "OAUTH_PROBE_FAILED",
      companyId: stored.row.companyId,
      userId: stored.row.userId,
      connectionId: connection.id,
      locationId,
      pitUpgrade,
    });
    if (!probe.ok) {
      return settingsRedirect(origin, "error=HighLevel+location+could+not+be+verified.+Tokens+were+saved.+Reconnect+if+this+continues.");
    }
    return settingsRedirect(origin, "connected=1");
  } catch {
    logHighLevelOAuth({
      reason: "OAUTH_EXCHANGE_FAILED",
      companyId: stored.row.companyId,
      userId: stored.row.userId,
      hasCode: true,
      hasState: true,
    });
    return settingsRedirect(origin, "error=HighLevel+authorization+failed.");
  }
}
