import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import {
  parseHighLevelWebhook,
  processHighLevelWebhook,
  resolveHighLevelConnectionByLocation,
  verifyHighLevelWebhookSignature,
} from "@/lib/highlevel/webhooks";

export async function POST(request: Request) {
  const raw = await request.text();
  const ghlSignature = request.headers.get("x-ghl-signature");
  const legacySignature = request.headers.get("x-wh-signature");
  const signed = Boolean(ghlSignature || legacySignature);
  if (signed && !verifyHighLevelWebhookSignature({ rawBody: raw, ghlSignature, legacySignature })) {
    return NextResponse.json({ ok: false, error: "Invalid signature." }, { status: 401 });
  }
  if (!signed && process.env.NODE_ENV === "production") {
    return NextResponse.json({ ok: false, error: "Missing HighLevel signature." }, { status: 401 });
  }

  let payload: Record<string, unknown> = {};
  try {
    payload = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON." }, { status: 400 });
  }

  const parsed = parseHighLevelWebhook(payload);
  const connection = await resolveHighLevelConnectionByLocation(prisma, parsed.locationId);
  if (!connection) {
    return NextResponse.json({ ok: true, ignored: true });
  }
  const result = await processHighLevelWebhook(prisma, {
    companyId: connection.companyId,
    connectionId: connection.id,
    payload,
  });
  return NextResponse.json({ ok: true, ...result });
}

export async function GET() {
  return NextResponse.json({ ok: true, provider: "highlevel" });
}
