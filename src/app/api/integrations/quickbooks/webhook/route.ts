import { createHmac, timingSafeEqual } from "crypto";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { QUICKBOOKS_PROVIDER_KEY } from "@/lib/quickbooks/config";
import { quickbooksWebhookConfigured } from "@/lib/quickbooks/webhook";

function validSignature(payload: string, signature: string | null) {
  const secret = process.env.INTUIT_WEBHOOK_VERIFIER_TOKEN?.trim();
  if (!secret || !signature) return false;
  const digest = createHmac("sha256", secret).update(payload).digest("base64");
  const left = Buffer.from(digest);
  const right = Buffer.from(signature);
  return left.length === right.length && timingSafeEqual(left, right);
}

export async function POST(request: Request) {
  if (!quickbooksWebhookConfigured()) {
    return NextResponse.json({ error: "QuickBooks webhooks are not configured." }, { status: 404 });
  }
  const payload = await request.text();
  const signature = request.headers.get("intuit-signature");
  if (!validSignature(payload, signature)) {
    return NextResponse.json({ error: "Invalid signature." }, { status: 401 });
  }
  let body: { eventNotifications?: Array<{ realmId?: string; dataChangeEvent?: { entities?: Array<{ name?: string; id?: string; operation?: string }> } }> };
  try {
    body = JSON.parse(payload) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid payload." }, { status: 400 });
  }
  for (const notice of body.eventNotifications ?? []) {
    const realmId = notice.realmId;
    if (!realmId) continue;
    const connection = await prisma.integrationConnection.findFirst({
      where: { providerKey: QUICKBOOKS_PROVIDER_KEY, externalAccountId: realmId },
      select: { companyId: true },
    });
    if (!connection) continue;
    const entities = notice.dataChangeEvent?.entities ?? [];
    for (const entity of entities) {
      if (!entity.id || !entity.name) continue;
      const action = `webhook.${(entity.operation || "change").toLowerCase()}`;
      const recent = await prisma.quickBooksSyncEvent.findFirst({
        where: {
          companyId: connection.companyId,
          entityType: entity.name.toUpperCase(),
          quickbooksId: entity.id,
          action,
          createdAt: { gte: new Date(Date.now() - 5 * 60 * 1000) },
        },
      });
      if (recent) continue;
      await prisma.quickBooksSyncEvent.create({
        data: {
          companyId: connection.companyId,
          entityType: entity.name.toUpperCase(),
          quickbooksId: entity.id,
          direction: "WEBHOOK",
          status: "PENDING",
          action,
        },
      });
    }
  }
  return NextResponse.json({ ok: true });
}
