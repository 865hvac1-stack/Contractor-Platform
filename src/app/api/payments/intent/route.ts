import { NextResponse } from "next/server";
import { AuthError } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { allowPaymentAttempt } from "@/lib/payments/rate-limit";
import { createInvoicePaymentIntent } from "@/lib/payments/intents";
import { requirePermission } from "@/lib/tenant";
import { assertCanCollectInvoice } from "@/server/actions/stripe-pay";

export async function POST(request: Request) {
  try {
    const ctx = await requirePermission("invoices:view");
    const body = (await request.json().catch(() => ({}))) as { invoiceId?: string; amountCents?: number };
    const invoiceId = String(body.invoiceId || "");
    if (!invoiceId) return NextResponse.json({ ok: false, error: "Invoice required." }, { status: 400 });
    if (body.amountCents != null) {
      return NextResponse.json({ ok: false, error: "Payment amount is determined by the invoice." }, { status: 400 });
    }
    const invoice = await prisma.invoice.findFirst({
      where: { id: invoiceId, companyId: ctx.company.id },
      select: { jobId: true },
    });
    if (!invoice) return NextResponse.json({ ok: false, error: "Invoice not found." }, { status: 404 });
    const allowed = await assertCanCollectInvoice(ctx.role, ctx.user.id, invoice.jobId);
    if (!allowed) {
      return NextResponse.json({ ok: false, error: "You cannot collect payment on this invoice." }, { status: 403 });
    }
    const key = `${ctx.company.id}:${ctx.user.id}:intent`;
    if (!allowPaymentAttempt(key, 12, 60_000)) {
      return NextResponse.json({ ok: false, error: "Too many payment attempts. Try again shortly." }, { status: 429 });
    }
    const result = await createInvoicePaymentIntent(prisma, {
      companyId: ctx.company.id,
      invoiceId,
      actorId: ctx.user.id,
    });
    if (!result.ok) return NextResponse.json(result, { status: 400 });
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }
    throw error;
  }
}
