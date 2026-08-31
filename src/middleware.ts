import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  SESSION_COOKIE_NAME,
  middlewareAuthDecision,
  sessionCookieClearOptions,
} from "@/lib/auth-session";

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
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
