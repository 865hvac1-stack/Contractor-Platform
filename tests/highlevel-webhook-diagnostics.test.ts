import { describe, expect, it, vi } from "vitest";
import { highlevelWebhookUrl } from "@/lib/highlevel/env";
import {
  HIGHLEVEL_WEBHOOK_MARKERS,
  PRODUCTION_HIGHLEVEL_WEBHOOK_URL,
  logHighLevelWebhookDiagnostic,
  sanitizeWebhookDiagnostic,
  webhookUrlMatchesProduction,
} from "@/lib/highlevel/webhook-diagnostics";
import { normalizeHighLevelInboundEvent, unwrapHighLevelWebhookBody } from "@/lib/highlevel/webhooks";

const PRODUCTION_ORIGIN = "https://contractor-platform-production-c444.up.railway.app";

describe("HighLevel inbound webhook diagnostics", () => {
  it("keeps the production Marketplace webhook URL unchanged", () => {
    const previous = process.env.APP_URL;
    process.env.APP_URL = PRODUCTION_ORIGIN;
    expect(PRODUCTION_HIGHLEVEL_WEBHOOK_URL).toBe(`${PRODUCTION_ORIGIN}/api/webhooks/highlevel`);
    expect(highlevelWebhookUrl()).toBe(PRODUCTION_HIGHLEVEL_WEBHOOK_URL);
    expect(webhookUrlMatchesProduction(highlevelWebhookUrl())).toBe(true);
    if (previous === undefined) delete process.env.APP_URL;
    else process.env.APP_URL = previous;
  });

  it("unwraps nested Marketplace envelopes so locationId still resolves", () => {
    const nested = unwrapHighLevelWebhookBody({
      payload: {
        type: "InboundMessage",
        locationId: "qPjPtcAUzdkBtYTJUUWB",
        messageType: "CALL",
        conversationId: "conv_nested_1",
        messageId: "msg_nested_1",
      },
    });
    expect(nested.type).toBe("InboundMessage");
    expect(nested.locationId).toBe("qPjPtcAUzdkBtYTJUUWB");
    const fields = normalizeHighLevelInboundEvent({
      webhook: {
        type: "InboundMessage",
        extras: { locationId: "qPjPtcAUzdkBtYTJUUWB" },
        messageType: "TYPE_CALL",
        conversationId: "conv_extras_1",
        messageId: "msg_extras_1",
      },
    });
    expect(fields.type).toBe("InboundMessage");
    expect(fields.locationId).toBe("qPjPtcAUzdkBtYTJUUWB");
    expect(fields.channel).toBe("CALL");
    expect(fields.conversationId).toBe("conv_extras_1");
  });

  it("normalizes the official inbound CALL payload without inventing phones", () => {
    const fields = normalizeHighLevelInboundEvent({
      type: "InboundMessage",
      locationId: "qPjPtcAUzdkBtYTJUUWB",
      direction: "inbound",
      messageType: "CALL",
      conversationId: "SGDqZrzmwTr19d10aHkt9F",
      messageId: "tyW42xCD0HQpb3hhfLcx",
      status: "completed",
    });
    expect(fields.type).toBe("InboundMessage");
    expect(fields.messageType).toBe("CALL");
    expect(fields.channel).toBe("CALL");
    expect(fields.from).toBeNull();
    expect(fields.to).toBeNull();
    expect(fields.body).toBeNull();
  });

  it("emits searchable markers and never logs phones, bodies, or signatures", () => {
    const lines: string[] = [];
    const spy = vi.spyOn(console, "info").mockImplementation((value: unknown) => {
      lines.push(String(value));
    });
    logHighLevelWebhookDiagnostic({
      marker: HIGHLEVEL_WEBHOOK_MARKERS.RECEIVED,
      route: "/api/webhooks/highlevel",
      hasSignature: true,
      bodyBytes: 240,
    });
    logHighLevelWebhookDiagnostic({
      marker: HIGHLEVEL_WEBHOOK_MARKERS.EVENT_TYPE,
      route: "/api/webhooks/highlevel",
      eventType: "InboundMessage",
      messageType: "CALL",
      locationId: "qPjPtcAUzdkBtYTJUUWB",
      conversationId: "conv_safe",
      messageId: "msg_safe",
    });
    logHighLevelWebhookDiagnostic({
      marker: HIGHLEVEL_WEBHOOK_MARKERS.FAILED,
      route: "/api/webhooks/highlevel",
      reason: "missing_signature",
      httpStatus: 401,
      processed: false,
      from: "+18655550123",
      to: "+18655550999",
      body: "do not log this voicemail transcript",
      signature: "base64-signature-must-not-appear",
    } as never);
    spy.mockRestore();

    const raw = lines.join("\n");
    expect(raw).toContain(HIGHLEVEL_WEBHOOK_MARKERS.RECEIVED);
    expect(raw).toContain(HIGHLEVEL_WEBHOOK_MARKERS.EVENT_TYPE);
    expect(raw).toContain(HIGHLEVEL_WEBHOOK_MARKERS.FAILED);
    expect(raw).not.toContain("+18655550123");
    expect(raw).not.toContain("voicemail transcript");
    expect(raw).not.toContain("base64-signature-must-not-appear");

    const failed = JSON.parse(lines[2] ?? "{}") as Record<string, unknown>;
    expect(failed.reason).toBe("missing_signature");
    expect(failed.httpStatus).toBe(401);
    expect(failed.processed).toBe(false);
    expect(failed).not.toHaveProperty("from");
    expect(failed).not.toHaveProperty("to");
    expect(failed).not.toHaveProperty("body");
    expect(failed).not.toHaveProperty("signature");
  });

  it("keeps only safe diagnostic fields", () => {
    const sanitized = sanitizeWebhookDiagnostic({
      marker: HIGHLEVEL_WEBHOOK_MARKERS.LOCATION_RESOLVED,
      route: "/api/webhooks/highlevel",
      eventType: "InboundMessage",
      locationId: "qPjPtcAUzdkBtYTJUUWB",
      locationMapped: false,
      reason: "location_unmapped",
      processed: false,
      httpStatus: 200,
    });
    expect(sanitized.marker).toBe(HIGHLEVEL_WEBHOOK_MARKERS.LOCATION_RESOLVED);
    expect(sanitized.event).toBe("highlevel.webhook.diagnostic");
    expect(Object.keys(HIGHLEVEL_WEBHOOK_MARKERS)).toEqual([
      "RECEIVED",
      "EVENT_TYPE",
      "LOCATION_RESOLVED",
      "PROCESSED",
      "FAILED",
    ]);
  });

  it("documents the webhook route markers in the handler", () => {
    const routeSource = require("node:fs").readFileSync("src/app/api/webhooks/highlevel/route.ts", "utf8");
    expect(routeSource).toContain("HIGHLEVEL_WEBHOOK_MARKERS.RECEIVED");
    expect(routeSource).toContain("HIGHLEVEL_WEBHOOK_MARKERS.EVENT_TYPE");
    expect(routeSource).toContain("HIGHLEVEL_WEBHOOK_MARKERS.LOCATION_RESOLVED");
    expect(routeSource).toContain("HIGHLEVEL_WEBHOOK_MARKERS.PROCESSED");
    expect(routeSource).toContain("HIGHLEVEL_WEBHOOK_MARKERS.FAILED");
    expect(routeSource).not.toMatch(/logHighLevelWebhookDiagnostic\(\{[^}]*from:/);
    expect(routeSource).not.toMatch(/logHighLevelWebhook(?:Diagnostic)?\(\{[^}]*ghlSignature/);
    expect(routeSource).not.toMatch(/console\.(?:log|info|error)\([^)]*headers/);
  });
});
