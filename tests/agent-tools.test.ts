import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  generateAgentToolKey,
  hashAgentToolKey,
  readBearerToken,
} from "@/lib/agent-tools/auth";
import { httpStatusForCode, toolError, toolOk } from "@/lib/agent-tools/envelope";
import { checkAgentToolRateLimit, resetAgentToolRateLimit } from "@/lib/agent-tools/rate-limit";
import { signSlotToken, verifySlotToken } from "@/lib/agent-tools/slot-token";
import { parseRequestedDaypart } from "@/lib/agent-tools/context";
import { isPublicPath, middlewareAuthDecision } from "@/lib/auth-session";

describe("Agent Tool authentication and tokens", () => {
  it("hashes keys and reads a bearer token without logging it", () => {
    const generated = generateAgentToolKey();
    expect(generated.plaintext.startsWith("cyat_")).toBe(true);
    expect(hashAgentToolKey(generated.plaintext)).toBe(generated.keyHash);
    expect(hashAgentToolKey(generated.plaintext)).not.toBe(generated.plaintext);
    const request = new Request("https://example.test/api/agent-tools/check-availability", {
      headers: { authorization: `Bearer ${generated.plaintext}` },
    });
    expect(readBearerToken(request)).toBe(generated.plaintext);
    expect(readBearerToken(new Request("https://example.test"))).toBeNull();
    const http = readFileSync(resolve("src/lib/agent-tools/http.ts"), "utf8");
    expect(http).not.toMatch(/console\.(log|info|debug).*authorization/i);
    expect(http).not.toMatch(/console\.(log|info|debug).*plaintext/);
  });

  it("rejects missing auth at the route boundary", () => {
    const route = readFileSync(resolve("src/app/api/agent-tools/check-availability/route.ts"), "utf8");
    expect(route).toMatch(/handleAgentToolPost/);
    expect(readFileSync(resolve("src/lib/agent-tools/http.ts"), "utf8")).toMatch(/authenticateAgentToolRequest/);
    expect(httpStatusForCode("UNAUTHORIZED")).toBe(401);
    expect(httpStatusForCode("LOCATION_MISMATCH")).toBe(403);
    expect(httpStatusForCode("RATE_LIMITED")).toBe(429);
    expect(httpStatusForCode("SLOT_NO_LONGER_AVAILABLE")).toBe(409);
  });

  it("lets Agent Studio reach the tools without a ContractorYou session cookie", () => {
    expect(isPublicPath("/api/agent-tools/check-availability")).toBe(true);
    expect(isPublicPath("/api/agent-tools/book-appointment")).toBe(true);
    expect(isPublicPath("/settings/highlevel")).toBe(false);
    expect(
      middlewareAuthDecision({
        pathname: "/api/agent-tools/check-availability",
        hasSessionCookie: false,
        signedOut: false,
      })
    ).toEqual({ allow: true, redirectTo: null, clearSessionCookie: false });
  });

  it("signs slot tokens to a company and rejects tampering", () => {
    process.env.SESSION_SECRET = process.env.SESSION_SECRET || "test-session-secret-value-32-chars-min";
    const token = signSlotToken({
      companyId: "co_865",
      date: "2026-09-09",
      windowId: "win_13",
      serviceTypeId: "svc_res",
    });
    expect(verifySlotToken(token, "co_865")?.windowId).toBe("win_13");
    expect(verifySlotToken(token, "co_other")).toBeNull();
    expect(verifySlotToken(`${token}x`, "co_865")).toBeNull();
    expect(verifySlotToken("not-a-token", "co_865")).toBeNull();
  });

  it("rate limits a credential without sending SMS", () => {
    resetAgentToolRateLimit();
    for (let i = 0; i < 60; i += 1) {
      expect(checkAgentToolRateLimit("cred_1").ok).toBe(true);
    }
    expect(checkAgentToolRateLimit("cred_1").ok).toBe(false);
    expect(checkAgentToolRateLimit("cred_2").ok).toBe(true);
  });
});

describe("Agent Tool scheduling adapter", () => {
  it("reuses canonical availability and booking services and never sends SMS", () => {
    const check = readFileSync(resolve("src/lib/agent-tools/check-availability.ts"), "utf8");
    const book = readFileSync(resolve("src/lib/agent-tools/book-appointment.ts"), "utf8");
    expect(check).toMatch(/getAvailability/);
    expect(check).toMatch(/findNextAvailableOptions/);
    expect(check).not.toMatch(/sendCompanyCommunication/);
    expect(book).toMatch(/bookAppointment\(/);
    expect(book).toMatch(/sendConfirmation: false/);
    expect(book).toMatch(/getAvailability/);
    expect(book).not.toMatch(/sendCompanyCommunication/);
    expect(readFileSync(resolve("src/lib/scheduling/index.ts"), "utf8")).toMatch(/evaluateCapacity/);
  });

  it("keeps HighLevel AI as conversation owner and does not invent 30-minute HighLevel slots", () => {
    const webhook = readFileSync(resolve("src/lib/highlevel/webhooks.ts"), "utf8");
    expect(webhook).toMatch(/contractorYouMayAutoreply/);
    expect(readFileSync(resolve("src/lib/agent-tools/check-availability.ts"), "utf8")).toMatch(/uniqueWindowOffers/);
    expect(readFileSync(resolve("src/lib/agent-tools/check-availability.ts"), "utf8")).not.toMatch(/30-minute/);
    expect(parseRequestedDaypart("afternoon")).toBe("AFTERNOON");
    expect(parseRequestedDaypart("morning")).toBe("MORNING");
  });

  it("returns an Agent Studio envelope", () => {
    const ok = toolOk("check_availability", { available_slots: [] }, { instruction: "Do not invent availability." });
    expect(ok.success).toBe(true);
    expect(ok.action).toBe("check_availability");
    expect(ok.error).toBeNull();
    const err = toolError("book_appointment", "SLOT_NO_LONGER_AVAILABLE", "That window is no longer available.");
    expect(err.success).toBe(false);
    expect(err.error?.code).toBe("SLOT_NO_LONGER_AVAILABLE");
  });

  it("documents Agent Studio setup without embedding secrets", () => {
    const docs = readFileSync(resolve("docs/HIGHLEVEL_AGENT_STUDIO.md"), "utf8");
    expect(docs).toMatch(/check-availability/);
    expect(docs).toMatch(/book-appointment/);
    expect(docs).toMatch(/Authorization: Bearer/);
    expect(docs).toMatch(/runtime.available_slots/);
    expect(docs).toMatch(/runtime.booking/);
    expect(docs).not.toMatch(/ghp_/);
    expect(docs).not.toMatch(/cyat_[A-Za-z0-9_-]{20,}/);
  });
});
