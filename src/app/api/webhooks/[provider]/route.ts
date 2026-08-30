import { createHash, timingSafeEqual } from "crypto";
import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";

function validSignature(secret: string, raw: string, header: string | null) {
  if (!secret || !header) return false;
  const digest = createHash("sha256").update(raw).update(secret).digest("hex");
  const left = Buffer.from(digest);
  const right = Buffer.from(header);
  return left.length === right.length && timingSafeEqual(left, right);
}

export async function POST(
  request: Request,
  context: { params: Promise<{ provider: string }> }
) {
  const { provider } = await context.params;
  const raw = await request.text();
  const signature =
    request.headers.get("x-hub-signature-256") ||
    request.headers.get("x-twilio-signature") ||
    request.headers.get("x-contractoryou-signature");

  const secret =
    provider === "meta"
      ? process.env.META_APP_SECRET
      : provider === "twilio"
        ? process.env.TWILIO_AUTH_TOKEN
        : process.env.INTEGRATION_WEBHOOK_SECRET;

  if (secret && !validSignature(secret, raw, signature)) {
    return NextResponse.json({ ok: false, error: "Invalid signature." }, { status: 401 });
  }

  let payload: Record<string, unknown> = {};
  try {
    payload = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
  } catch {
    payload = { raw: "non-json" };
  }

  const externalId =
    (payload.id as string) ||
    request.headers.get("x-request-id") ||
    createHash("sha256").update(raw).digest("hex");

  const connection = await prisma.integrationConnection.findFirst({
    where: { providerKey: provider === "twilio" ? "sms" : provider, status: "CONNECTED" },
    orderBy: { updatedAt: "desc" },
  });

  if (connection) {
    await prisma.integrationEvent.upsert({
      where: {
        companyId_connectionId_externalId: {
          companyId: connection.companyId,
          connectionId: connection.id,
          externalId,
        },
      },
      create: {
        companyId: connection.companyId,
        connectionId: connection.id,
        externalId,
        eventType: `${provider}.webhook`,
        payload: payload as Prisma.InputJsonValue,
        processedAt: new Date(),
      },
      update: { processedAt: new Date() },
    });
  }

  return NextResponse.json({ ok: true });
}

export async function GET(
  request: Request,
  context: { params: Promise<{ provider: string }> }
) {
  const { provider } = await context.params;
  const url = new URL(request.url);
  if (provider === "meta") {
    const challenge = url.searchParams.get("hub.challenge");
    const verify = url.searchParams.get("hub.verify_token");
    if (verify && verify === process.env.META_WEBHOOK_VERIFY_TOKEN && challenge) {
      return new NextResponse(challenge, { status: 200 });
    }
  }
  return NextResponse.json({ ok: true });
}
