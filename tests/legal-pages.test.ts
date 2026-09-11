import { describe, expect, it } from "vitest";
import { isPublicPath, middlewareAuthDecision } from "@/lib/auth-session";
import { LEGAL_GOVERNING_LAW, LEGAL_LAST_UPDATED, LEGAL_PAGES } from "@/lib/legal";
import { FALLBACK_SUPPORT_EMAIL, supportEmail } from "@/lib/support";

describe("public legal pages", () => {
  it("allows /terms and /privacy without a session cookie", () => {
    expect(isPublicPath("/terms")).toBe(true);
    expect(isPublicPath("/privacy")).toBe(true);
    expect(
      middlewareAuthDecision({ pathname: "/terms", hasSessionCookie: false, signedOut: false })
    ).toEqual({ allow: true, redirectTo: null, clearSessionCookie: false });
    expect(
      middlewareAuthDecision({ pathname: "/privacy", hasSessionCookie: false, signedOut: false })
    ).toEqual({ allow: true, redirectTo: null, clearSessionCookie: false });
  });

  it("does not treat legal pages as login-gated app routes", () => {
    expect(isPublicPath("/settings")).toBe(false);
    expect(
      middlewareAuthDecision({ pathname: "/settings", hasSessionCookie: false, signedOut: false }).redirectTo
    ).toBe("/login");
  });

  it("exposes Intuit-ready metadata and Tennessee governing law", () => {
    expect(LEGAL_PAGES.terms.title).toBe("ContractorYou Terms of Service");
    expect(LEGAL_PAGES.terms.description).toBe("Terms governing use of ContractorYou.");
    expect(LEGAL_PAGES.privacy.title).toBe("ContractorYou Privacy Policy");
    expect(LEGAL_PAGES.privacy.description).toBe("How ContractorYou collects, uses, and protects information.");
    expect(LEGAL_GOVERNING_LAW).toBe("Tennessee, United States");
    expect(LEGAL_LAST_UPDATED).toMatch(/2026/);
  });

  it("uses an env support address when set and otherwise the documented fallback", () => {
    const previousPublic = process.env.NEXT_PUBLIC_SUPPORT_EMAIL;
    const previousSupport = process.env.SUPPORT_EMAIL;
    delete process.env.NEXT_PUBLIC_SUPPORT_EMAIL;
    delete process.env.SUPPORT_EMAIL;
    expect(supportEmail()).toBe(FALLBACK_SUPPORT_EMAIL);
    process.env.SUPPORT_EMAIL = "ops@example.test";
    expect(supportEmail()).toBe("ops@example.test");
    process.env.NEXT_PUBLIC_SUPPORT_EMAIL = "hello@contractoryou.test";
    expect(supportEmail()).toBe("hello@contractoryou.test");
    if (previousPublic) process.env.NEXT_PUBLIC_SUPPORT_EMAIL = previousPublic;
    else delete process.env.NEXT_PUBLIC_SUPPORT_EMAIL;
    if (previousSupport) process.env.SUPPORT_EMAIL = previousSupport;
    else delete process.env.SUPPORT_EMAIL;
  });
});
