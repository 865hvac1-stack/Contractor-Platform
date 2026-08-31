import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { allowPaymentAttempt } from "@/lib/payments/rate-limit";
import { createInvoicePaymentIntent } from "@/lib/payments/intents";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { token?: string };
  const token = String(body.token || "").trim();
  if (!token) return NextResponse.json({ ok: false, error: "Invoice not found." }, { status: 404 });
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "public";
  if (!allowPaymentAttempt(`public:${ip}:${token}`, 8, 60_000)) {
    return NextResponse.json({ ok: false, error: "Too many payment attempts. Try again shortly." }, { status: 429 });
  }
  const invoice = await prisma.invoice.findFirst({ where: { publicToken: token } });
  if (!invoice) return NextResponse.json({ ok: false, error: "Invoice not found." }, { status: 404 });
  const result = await createInvoicePaymentIntent(prisma, {
    companyId: invoice.companyId,
    invoiceId: invoice.id,
  });
  if (!result.ok) return NextResponse.json(result, { status: 400 });
  return NextResponse.json(result);
}
