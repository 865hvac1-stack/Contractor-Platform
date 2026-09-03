import { NextResponse } from "next/server";
import { consumeOAuthStateDetailed } from "@/lib/integrations/oauth/state";
import { HIGHLEVEL_PROVIDER_KEY } from "@/lib/highlevel/config";
import { exchangeHighLevelCode, HighLevelOAuthExchangeError, highlevelOAuthRedirectUri } from "@/lib/highlevel/oauth";
import { saveConnectionTokens, upsertConnection } from "@/lib/integrations/store";
import { writeAudit } from "@/lib/audit";
import { appUrl } from "@/lib/integrations/env";
import { upsertIdentityMap } from "@/lib/highlevel/identity";
import { logHighLevelOAuth } from "@/lib/highlevel/oauth-log";
import { MARKETPLACE_OAUTH_CALLBACK_PATH } from "@/lib/integrations/env";
import {
  HIGHLEVEL_OAUTH_MARKERS,
  logHighLevelOAuthDiagnostic,
  redirectUriMatchesProduction,
} from "@/lib/highlevel/oauth-diagnostics";

const START_FROM_CONTRACTORYOU =
  "Start HighLevel from ContractorYou Settings. Click Connect HighLevel from the company that should own this location. A HighLevel Marketplace install link cannot create ContractorYou authorization state.";

function settingsRedirect(origin: string, query: string) {
  return NextResponse.redirect(new URL(`/settings/highlevel?${query}`, origin));
}

function redirectUriParts() {
  try {
    const uri = new URL(highlevelOAuthRedirectUri());
    return { host: uri.host, path: uri.pathname };
  } catch {
    return { host: null, path: null };
  }
}

function diagnosticError(error: unknown) {
  if (error instanceof HighLevelOAuthExchangeError) {
    return { errorClass: error.errorClass, errorMessage: error.message, httpStatus: error.httpStatus };
  }
  if (error instanceof Error) {
    return { errorClass: error.name || "Error", errorMessage: error.message, httpStatus: null as number | null };
  }
  return { errorClass: "UnknownError", errorMessage: "OAuth failed.", httpStatus: null as number | null };
}

/** Marketplace OAuth authorization-code callback. Used by /api/integrations/oauth/callback. */
export async function handleHighLevelMarketplaceCallback(request: Request) {
  const url = new URL(request.url);
  const origin = appUrl();
  const error = url.searchParams.get("error");
  const code = url.searchParams.get("code") ?? "";
  const state = url.searchParams.get("state") ?? "";
  const route = MARKETPLACE_OAUTH_CALLBACK_PATH;
  const redirectMatches = redirectUriMatchesProduction(highlevelOAuthRedirectUri());

  logHighLevelOAuthDiagnostic({
    marker: HIGHLEVEL_OAUTH_MARKERS.CALLBACK_RECEIVED,
    route,
    hasCode: Boolean(code),
    hasState: Boolean(state),
    hasError: Boolean(error),
    redirectUriMatchesProduction: redirectMatches,
  });

  if (error) {
    logHighLevelOAuth({ reason: "OAUTH_EXCHANGE_FAILED", error, hasCode: false, hasState: false });
    return settingsRedirect(origin, `error=${encodeURIComponent(error)}`);
  }
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
    logHighLevelOAuthDiagnostic({
      marker: HIGHLEVEL_OAUTH_MARKERS.STATE_INVALID,
      route,
      httpStatus: 302,
      hasCode: Boolean(code),
      hasState: Boolean(state),
      reason: stored.reason,
    });
    if (stored.reason === "OAUTH_STATE_MISSING") {
      return settingsRedirect(origin, `error=${encodeURIComponent(START_FROM_CONTRACTORYOU)}`);
    }
    return settingsRedirect(origin, "error=Authorization+expired.+Start+again.");
  }
  logHighLevelOAuthDiagnostic({
    marker: HIGHLEVEL_OAUTH_MARKERS.STATE_VALID,
    route,
    companyId: stored.row.companyId,
    hasCode: Boolean(code),
    hasState: true,
  });
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
  logHighLevelOAuthDiagnostic({
    marker: HIGHLEVEL_OAUTH_MARKERS.CODE_EXCHANGE_START,
    route,
    companyId: stored.row.companyId,
    hasCode: true,
    hasState: true,
    redirectUriMatchesProduction: redirectMatches,
  });
  let exchanged: Awaited<ReturnType<typeof exchangeHighLevelCode>>;
  try {
    exchanged = await exchangeHighLevelCode(code);
  } catch (error) {
    const details = diagnosticError(error);
    logHighLevelOAuthDiagnostic({
      marker: HIGHLEVEL_OAUTH_MARKERS.CODE_EXCHANGE_FAILED,
      route,
      companyId: stored.row.companyId,
      httpStatus: details.httpStatus,
      hasCode: true,
      hasState: true,
      errorClass: details.errorClass,
      errorMessage: details.errorMessage,
    });
    logHighLevelOAuth({
      reason: "OAUTH_EXCHANGE_FAILED",
      companyId: stored.row.companyId,
      userId: stored.row.userId,
      hasCode: true,
      hasState: true,
      error: details.errorMessage,
    });
    return settingsRedirect(origin, "error=HighLevel+authorization+failed.");
  }
  try {
    logHighLevelOAuthDiagnostic({
      marker: HIGHLEVEL_OAUTH_MARKERS.CODE_EXCHANGE_SUCCESS,
      route,
      companyId: stored.row.companyId,
      httpStatus: exchanged.httpStatus ?? 200,
      hasCode: true,
      hasState: true,
    });
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
    logHighLevelOAuthDiagnostic({
      marker: HIGHLEVEL_OAUTH_MARKERS.LOCATION_RESOLVED,
      route,
      companyId: stored.row.companyId,
      locationId,
      reason: "resolved",
    });
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
        logHighLevelOAuthDiagnostic({
          marker: HIGHLEVEL_OAUTH_MARKERS.LOCATION_RESOLVED,
          route,
          companyId: stored.row.companyId,
          locationId,
          httpStatus: 302,
          reason: "owned_by_other_company",
          errorClass: "LocationOwnershipError",
          errorMessage: grant.error,
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
      logHighLevelOAuthDiagnostic({
        marker: HIGHLEVEL_OAUTH_MARKERS.LOCATION_RESOLVED,
        route,
        companyId: stored.row.companyId,
        locationId,
        httpStatus: 302,
        reason: "owned_by_other_company",
        errorClass: "LocationOwnershipError",
        errorMessage: locationLock.error,
      });
      return settingsRedirect(origin, `error=${encodeURIComponent(locationLock.error)}`);
    }
    const existing = await prisma.integrationConnection.findFirst({
      where: { companyId: stored.row.companyId, providerKey: HIGHLEVEL_PROVIDER_KEY },
    });
    const pitUpgrade =
      Boolean(existing?.scopes.includes("private_token")) &&
      (existing?.externalAccountId === locationId || !existing?.externalAccountId);

    const probe = await probeHighLevelLocation(exchanged.tokens.accessToken, locationId, {
      tokenLocationId: exchanged.locationId,
      userType: exchanged.userType,
    });
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
    logHighLevelOAuthDiagnostic({
      marker: HIGHLEVEL_OAUTH_MARKERS.CONNECTION_SAVED,
      route,
      companyId: stored.row.companyId,
      locationId,
      httpStatus: probe.ok ? 200 : 502,
      reason: probe.ok ? (pitUpgrade ? "oauth_upgraded_from_pit" : "oauth_connected") : "oauth_probe_failed",
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
  } catch (error) {
    const details = diagnosticError(error);
    logHighLevelOAuth({
      reason: "OAUTH_EXCHANGE_FAILED",
      companyId: stored.row.companyId,
      userId: stored.row.userId,
      hasCode: true,
      hasState: true,
      error: details.errorMessage,
    });
    return settingsRedirect(origin, "error=HighLevel+authorization+failed.");
  }
}
