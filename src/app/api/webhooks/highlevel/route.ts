import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import {
  normalizeHighLevelInboundEvent,
  processHighLevelWebhook,
  resolveHighLevelConnectionByLocation,
  verifyHighLevelWebhookSignature,
} from "@/lib/highlevel/webhooks";
import { logHighLevelWebhook } from "@/lib/highlevel/webhook-log";

export async function POST(request: Request) {
  const raw = await request.text();
  const ghlSignature = request.headers.get("x-ghl-signature");
  const legacySignature = request.headers.get("x-wh-signature");
  const signed = Boolean(ghlSignature || legacySignature);
  if (signed && !verifyHighLevelWebhookSignature({ rawBody: raw, ghlSignature, legacySignature })) {
    logHighLevelWebhook({
      stage: "auth_failed",
      signed: true,
      error: "Invalid HighLevel signature.",
    });
    return NextResponse.json({ ok: false, error: "Invalid signature." }, { status: 401 });
  }
  if (!signed && process.env.NODE_ENV === "production") {
    logHighLevelWebhook({
      stage: "auth_failed",
      signed: false,
      error: "Missing HighLevel signature.",
    });
    return NextResponse.json({ ok: false, error: "Missing HighLevel signature." }, { status: 401 });
  }

  let payload: Record<string, unknown> = {};
  try {
    payload = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
  } catch {
    logHighLevelWebhook({
      stage: "parse_failed",
      signed,
      error: "Invalid JSON.",
    });
    return NextResponse.json({ ok: false, error: "Invalid JSON." }, { status: 400 });
  }

  const fields = normalizeHighLevelInboundEvent(payload);
  logHighLevelWebhook({
    stage: "received",
    signed,
    eventType: fields.type,
    locationId: fields.locationId || null,
    webhookId: fields.webhookId || null,
    conversationId: fields.conversationId,
    messageId: fields.messageId,
    contactId: fields.contactId,
    channel: fields.channel,
    direction: fields.direction,
    from: fields.from,
    to: fields.to,
    hasRecording: fields.hasRecording,
  });

  const connection = await resolveHighLevelConnectionByLocation(prisma, fields.locationId);
  if (!connection) {
    logHighLevelWebhook({
      stage: "location_unmapped",
      signed,
      eventType: fields.type,
      locationMapped: false,
      locationId: fields.locationId || null,
      webhookId: fields.webhookId || null,
    });
    return NextResponse.json({ ok: true, ignored: true });
  }

  try {
    const result = await processHighLevelWebhook(prisma, {
      companyId: connection.companyId,
      connectionId: connection.id,
      payload,
    });
    logHighLevelWebhook({
      stage: result.duplicate ? "duplicate" : "processed",
      signed,
      eventType: result.type,
      locationMapped: true,
      locationId: result.locationId || fields.locationId || null,
      companyId: connection.companyId,
      connectionId: connection.id,
      webhookId: fields.webhookId || null,
      conversationId: result.conversationId,
      messageId: result.messageId,
      contactId: result.contactId,
      channel: result.channel,
      direction: result.direction,
      from: result.from,
      to: result.to,
      trackingSource: result.trackingSource,
      customerMatched: result.customerMatched,
      leadCreated: result.leadCreated,
      callRecordCreated: result.callRecordCreated,
      callRecordUpdated: result.callRecordUpdated,
      threadId: result.threadId,
      hasRecording: result.hasRecording,
      idempotency: result.duplicate ? "duplicate" : "new",
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    logHighLevelWebhook({
      stage: "failed",
      signed,
      eventType: fields.type,
      locationMapped: true,
      locationId: fields.locationId || null,
      companyId: connection.companyId,
      connectionId: connection.id,
      webhookId: fields.webhookId || null,
      error: error instanceof Error ? error.message : "Webhook processing failed.",
    });
    return NextResponse.json({ ok: false, error: "Webhook processing failed." }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json({ ok: true, provider: "highlevel" });
}
