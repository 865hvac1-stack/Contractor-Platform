import { generateKeyPairSync, sign } from "crypto";
import { describe, expect, it, vi } from "vitest";
import { isPublicPath, middlewareAuthDecision } from "@/lib/auth-session";
import { HIGHLEVEL_ED25519_PUBLIC_KEY } from "@/lib/highlevel/config";
import {
  evaluateHighLevelWebhookAuth,
  verifyHighLevelWebhookSignature,
} from "@/lib/highlevel/webhooks";
import { HIGHLEVEL_WEBHOOK_MARKERS, logHighLevelWebhookDiagnostic } from "@/lib/highlevel/webhook-diagnostics";
import {
  HIGHLEVEL_WEBHOOK_ROUTE,
  inspectHighLevelWebhookHeaders,
  isHighLevelWebhookPost,
} from "@/lib/highlevel/webhook-headers";

function headerMap(entries: Record<string, string>) {
  return {
    get(name: string) {
      return entries[name.toLowerCase()] ?? null;
    },
  };
}

describe("HighLevel Marketplace webhook authentication", () => {
  it("does not require a session or Authorization header to reach the webhook path", () => {
    expect(isPublicPath(HIGHLEVEL_WEBHOOK_ROUTE)).toBe(true);
    expect(
      middlewareAuthDecision({
        pathname: HIGHLEVEL_WEBHOOK_ROUTE,
        hasSessionCookie: false,
        signedOut: false,
      }),
    ).toEqual({ allow: true, redirectTo: null, clearSessionCookie: false });
    expect(isHighLevelWebhookPost(HIGHLEVEL_WEBHOOK_ROUTE, "POST")).toBe(true);
  });

  it("reports official signature header names as presence only", () => {
    expect(inspectHighLevelWebhookHeaders(headerMap({}))).toEqual({
      hasXGhlSignature: false,
      hasXWhSignature: false,
      hasAuthorization: false,
    });
    expect(
      inspectHighLevelWebhookHeaders(
        headerMap({
          "x-ghl-signature": "base64-not-logged",
          authorization: "Bearer must-not-be-required",
        }),
      ),
    ).toEqual({
      hasXGhlSignature: true,
      hasXWhSignature: false,
      hasAuthorization: true,
    });
  });

  it("matches official Marketplace verification: raw UTF-8 body + Ed25519 X-GHL-Signature", () => {
    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    const rawBody = JSON.stringify({ type: "InboundMessage", locationId: "qPjPtcAUzdkBtYTJUUWB" });
    const signature = sign(null, Buffer.from(rawBody, "utf8"), privateKey).toString("base64");
    const verified = evaluateHighLevelWebhookAuth({
      rawBody,
      ghlSignature: signature,
      requireSignature: true,
      ed25519PublicKey: publicKey.export({ type: "spki", format: "pem" }).toString(),
    });
    expect(verified).toEqual({ ok: true, reason: "verified", algorithm: "ed25519" });
    expect(
      evaluateHighLevelWebhookAuth({
        rawBody,
        ghlSignature: signature,
        requireSignature: true,
        ed25519PublicKey: HIGHLEVEL_ED25519_PUBLIC_KEY,
      }).ok,
    ).toBe(false);
    expect(verifyHighLevelWebhookSignature({ rawBody, ghlSignature: "not-valid" })).toBe(false);
    expect(evaluateHighLevelWebhookAuth({ rawBody, requireSignature: true })).toEqual({
      ok: false,
      reason: "missing_signature",
      algorithm: null,
    });
  });

  it("does not treat Authorization or a shared secret as Marketplace webhook auth", () => {
    const source = require("node:fs").readFileSync("src/lib/highlevel/webhooks.ts", "utf8");
    const route = require("node:fs").readFileSync("src/app/api/webhooks/highlevel/route.ts", "utf8");
    const middleware = require("node:fs").readFileSync("src/middleware.ts", "utf8");
    expect(source).toContain("cryptoVerify(");
    expect(source).toContain("HIGHLEVEL_ED25519_PUBLIC_KEY");
    expect(source).toContain('algorithm: "ed25519"');
    expect(source).not.toMatch(/createHmac|INTEGRATION_WEBHOOK_SECRET|HIGHLEVEL_WEBHOOK_SECRET/);
    expect(route).not.toMatch(/headers\.get\("authorization"\)/);
    expect(route).toContain("HIGHLEVEL_WEBHOOK_MARKERS.RECEIVED");
    expect(middleware).toContain("HIGHLEVEL_WEBHOOK_MARKERS.RECEIVED");
    expect(middleware).not.toMatch(/status:\s*401/);
  });

  it("logs header presence without header values on rejected requests", () => {
    const lines: string[] = [];
    const spy = vi.spyOn(console, "info").mockImplementation((value: unknown) => {
      lines.push(String(value));
    });
    logHighLevelWebhookDiagnostic({
      marker: HIGHLEVEL_WEBHOOK_MARKERS.RECEIVED,
      route: HIGHLEVEL_WEBHOOK_ROUTE,
      layer: "route",
      requestReachedRoute: true,
      hasXGhlSignature: false,
      hasXWhSignature: false,
      hasAuthorization: false,
      hasSignature: false,
    });
    logHighLevelWebhookDiagnostic({
      marker: HIGHLEVEL_WEBHOOK_MARKERS.FAILED,
      route: HIGHLEVEL_WEBHOOK_ROUTE,
      layer: "route",
      requestReachedRoute: true,
      httpStatus: 401,
      reason: "missing_signature",
      processed: false,
      hasXGhlSignature: false,
      hasXWhSignature: false,
      hasAuthorization: true,
      signature: "must-not-appear",
      authorization: "Bearer secret",
    } as never);
    spy.mockRestore();
    const raw = lines.join("\n");
    expect(raw).toContain(HIGHLEVEL_WEBHOOK_MARKERS.RECEIVED);
    expect(raw).toContain(HIGHLEVEL_WEBHOOK_MARKERS.FAILED);
    expect(raw).not.toContain("must-not-appear");
    expect(raw).not.toContain("Bearer secret");
    const failed = JSON.parse(lines[1] ?? "{}") as Record<string, unknown>;
    expect(failed.httpStatus).toBe(401);
    expect(failed.reason).toBe("missing_signature");
    expect(failed.hasAuthorization).toBe(true);
    expect(failed).not.toHaveProperty("signature");
    expect(failed).not.toHaveProperty("authorization");
  });
});
