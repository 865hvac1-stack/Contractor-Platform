import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  SESSION_COOKIE_NAME,
  middlewareAuthDecision,
  sessionCookieClearOptions,
} from "@/lib/auth-session";
import { HIGHLEVEL_WEBHOOK_MARKERS, logHighLevelWebhookDiagnostic } from "@/lib/highlevel/webhook-diagnostics";
import { HIGHLEVEL_WEBHOOK_ROUTE, inspectHighLevelWebhookHeaders, isHighLevelWebhookPost } from "@/lib/highlevel/webhook-headers";

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (isHighLevelWebhookPost(pathname, request.method)) {
    const headers = inspectHighLevelWebhookHeaders(request.headers);
    logHighLevelWebhookDiagnostic({
      marker: HIGHLEVEL_WEBHOOK_MARKERS.RECEIVED,
      route: HIGHLEVEL_WEBHOOK_ROUTE,
      layer: "middleware",
      requestReachedRoute: false,
      hasXGhlSignature: headers.hasXGhlSignature,
      hasXWhSignature: headers.hasXWhSignature,
      hasAuthorization: headers.hasAuthorization,
      hasSignature: headers.hasXGhlSignature || headers.hasXWhSignature,
    });
  }
  const session = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  const signedOut = request.nextUrl.searchParams.get("signedOut") === "1";
  const decision = middlewareAuthDecision({
    pathname,
    hasSessionCookie: Boolean(session),
    signedOut,
  });

  if (decision.redirectTo) {
    const target = new URL(decision.redirectTo, request.url);
    if (decision.redirectTo === "/login") target.searchParams.set("next", pathname);
    const response = NextResponse.redirect(target);
    if (decision.clearSessionCookie) {
      response.cookies.set(SESSION_COOKIE_NAME, "", sessionCookieClearOptions());
    }
    return response;
  }

  const response = NextResponse.next();
  if (decision.clearSessionCookie) {
    response.cookies.set(SESSION_COOKIE_NAME, "", sessionCookieClearOptions());
  }
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|.*\\..*).*)"],
};
