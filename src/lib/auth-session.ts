export const SESSION_COOKIE_NAME = "cp_session";

export function sessionCookieClearOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    expires: new Date(0),
    maxAge: 0,
  };
}

const PUBLIC_EXACT = new Set([
  "/",
  "/login",
  "/register",
  "/forgot-password",
  "/reset-password",
]);

export function isPublicPath(pathname: string) {
  return (
    PUBLIC_EXACT.has(pathname) ||
    pathname.startsWith("/_next") ||
    pathname.startsWith("/favicon") ||
    pathname.startsWith("/api/health") ||
    pathname.startsWith("/f/") ||
    pathname.startsWith("/p/") ||
    pathname.startsWith("/e/") ||
    pathname.startsWith("/i/") ||
    pathname.startsWith("/invite") ||
    pathname.startsWith("/api/forms/") ||
    pathname.startsWith("/api/payments/") ||
    pathname.startsWith("/api/webhooks/") ||
    (pathname.startsWith("/api/integrations/") && pathname.includes("/callback"))
  );
}

export function isLoginPublicPath(pathname: string, signedOut: boolean) {
  if (pathname === "/login" || pathname === "/register") return true;
  if (signedOut && (pathname === "/login" || pathname.startsWith("/login"))) return true;
  return false;
}

export function middlewareAuthDecision(input: {
  pathname: string;
  hasSessionCookie: boolean;
  signedOut: boolean;
}) {
  const publicPath = isPublicPath(input.pathname);
  if (input.signedOut && (input.pathname === "/login" || input.pathname.startsWith("/login"))) {
    return { allow: true, redirectTo: null as string | null, clearSessionCookie: true };
  }
  if (!publicPath && !input.hasSessionCookie) {
    return { allow: false, redirectTo: "/login", clearSessionCookie: false };
  }
  if (input.hasSessionCookie && !input.signedOut && input.pathname === "/register") {
    return { allow: false, redirectTo: "/dashboard", clearSessionCookie: false };
  }
  return { allow: true, redirectTo: null as string | null, clearSessionCookie: false };
}
