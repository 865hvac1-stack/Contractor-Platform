import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import {
  evaluateHighLevelWebhookAuth,
  normalizeHighLevelInboundEvent,
  processHighLevelWebhook,
  resolveHighLevelConnectionByLocation,
} from "@/lib/highlevel/webhooks";
import { logHighLevelWebhook } from "@/lib/highlevel/webhook-log";
import {
  HIGHLEVEL_WEBHOOK_MARKERS,
  logHighLevelWebhookDiagnostic,
} from "@/lib/highlevel/webhook-diagnostics";
import {
  HIGHLEVEL_GHL_SIGNATURE_HEADER,
  HIGHLEVEL_LEGACY_SIGNATURE_HEADER,
  HIGHLEVEL_WEBHOOK_ROUTE,
  inspectHighLevelWebhookHeaders,
} from "@/lib/highlevel/webhook-headers";

const ROUTE = HIGHLEVEL_WEBHOOK_ROUTE;

function authDiagnosticFields(headers: ReturnType<typeof inspectHighLevelWebhookHeaders>) {
  return {
    hasXGhlSignature: headers.hasXGhlSignature,
    hasXWhSignature: headers.hasXWhSignature,
    hasAuthorization: headers.hasAuthorization,
    hasSignature: headers.hasXGhlSignature || headers.hasXWhSignature,
  };
}

function unauthorized(reason: "missing_signature" | "invalid_signature", headers: ReturnType<typeof inspectHighLevelWebhookHeaders>) {
  const error = reason === "missing_signature" ? "Missing HighLevel signature." : "Invalid signature.";
  const response = NextResponse.json({ ok: false, error }, { status: 401 });
  response.headers.set("x-cy-webhook-reason", reason);
  logHighLevelWebhook({
    stage: "auth_failed",
    signed: headers.hasXGhlSignature || headers.hasXWhSignature,
    error,
  });
  logHighLevelWebhookDiagnostic({
    marker: HIGHLEVEL_WEBHOOK_MARKERS.FAILED,
    route: ROUTE,
    layer: "route",
    requestReachedRoute: true,
    httpStatus: 401,
    reason,
    processed: false,
    ...authDiagnosticFields(headers),
  });
  return response;
}

export async function POST(request: Request) {
  const headerPresence = inspectHighLevelWebhookHeaders(request.headers);
  logHighLevelWebhookDiagnostic({
    marker: HIGHLEVEL_WEBHOOK_MARKERS.RECEIVED,
    route: ROUTE,
    layer: "route",
    requestReachedRoute: true,
    ...authDiagnosticFields(headerPresence),
  });

  const raw = await request.text();
  const ghlSignature = request.headers.get(HIGHLEVEL_GHL_SIGNATURE_HEADER);
  const legacySignature = request.headers.get(HIGHLEVEL_LEGACY_SIGNATURE_HEADER);
  const auth = evaluateHighLevelWebhookAuth({
    rawBody: raw,
    ghlSignature,
    legacySignature,
    requireSignature: process.env.NODE_ENV === "production",
  });
  const signed = headerPresence.hasXGhlSignature || headerPresence.hasXWhSignature;

  if (!auth.ok && (auth.reason === "missing_signature" || auth.reason === "invalid_signature")) {
    return unauthorized(auth.reason, headerPresence);
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
    logHighLevelWebhookDiagnostic({
      marker: HIGHLEVEL_WEBHOOK_MARKERS.FAILED,
      route: ROUTE,
      hasSignature: signed,
      httpStatus: 400,
      reason: "invalid_json",
      processed: false,
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
    hasRecording: fields.hasRecording,
  });
  logHighLevelWebhookDiagnostic({
    marker: HIGHLEVEL_WEBHOOK_MARKERS.EVENT_TYPE,
    route: ROUTE,
    eventType: fields.type,
    messageType: fields.messageType,
    locationId: fields.locationId || null,
    conversationId: fields.conversationId,
    messageId: fields.messageId,
    channel: fields.channel,
    direction: fields.direction,
    hasSignature: signed,
  });

  const connection = await resolveHighLevelConnectionByLocation(prisma, fields.locationId);
  logHighLevelWebhookDiagnostic({
    marker: HIGHLEVEL_WEBHOOK_MARKERS.LOCATION_RESOLVED,
    route: ROUTE,
    eventType: fields.type,
    locationId: fields.locationId || null,
    locationMapped: Boolean(connection),
    companyId: connection?.companyId ?? null,
    connectionId: connection?.id ?? null,
    hasSignature: signed,
  });
  if (!connection) {
    logHighLevelWebhook({
      stage: "location_unmapped",
      signed,
      eventType: fields.type,
      locationMapped: false,
      locationId: fields.locationId || null,
      webhookId: fields.webhookId || null,
    });
    logHighLevelWebhookDiagnostic({
      marker: HIGHLEVEL_WEBHOOK_MARKERS.FAILED,
      route: ROUTE,
      eventType: fields.type,
      locationId: fields.locationId || null,
      locationMapped: false,
      httpStatus: 200,
      reason: "location_unmapped",
      processed: false,
      hasSignature: signed,
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
      trackingSource: result.trackingSource,
      customerMatched: result.customerMatched,
      leadCreated: result.leadCreated,
      callRecordCreated: result.callRecordCreated,
      callRecordUpdated: result.callRecordUpdated,
      threadId: result.threadId,
      hasRecording: result.hasRecording,
      idempotency: result.duplicate ? "duplicate" : "new",
    });
    logHighLevelWebhookDiagnostic({
      marker: HIGHLEVEL_WEBHOOK_MARKERS.PROCESSED,
      route: ROUTE,
      eventType: result.type,
      messageType: fields.messageType,
      locationId: result.locationId || fields.locationId || null,
      conversationId: result.conversationId,
      messageId: result.messageId,
      companyId: connection.companyId,
      connectionId: connection.id,
      channel: result.channel,
      direction: result.direction,
      locationMapped: true,
      processed: result.processed,
      duplicate: result.duplicate,
      httpStatus: 200,
      hasSignature: signed,
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
    logHighLevelWebhookDiagnostic({
      marker: HIGHLEVEL_WEBHOOK_MARKERS.FAILED,
      route: ROUTE,
      eventType: fields.type,
      locationId: fields.locationId || null,
      companyId: connection.companyId,
      connectionId: connection.id,
      locationMapped: true,
      httpStatus: 500,
      reason: "processing_failed",
      processed: false,
      hasSignature: signed,
    });
    return NextResponse.json({ ok: false, error: "Webhook processing failed." }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json({ ok: true, provider: "highlevel" });
}
