import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { constructStripeEvent, processStripeEvent } from "@/lib/payments/webhooks";

export async function POST(request: Request) {
  const raw = await request.text();
  const constructed = constructStripeEvent(raw, request.headers.get("stripe-signature"));
  if (!constructed.ok) {
    return NextResponse.json({ ok: false, error: constructed.error }, { status: constructed.status });
  }
  const result = await processStripeEvent(prisma, constructed.event);
  return NextResponse.json({ ok: true, duplicate: result.duplicate });
}
