"use server";

import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/tenant";
import { AuthError } from "@/lib/auth";
import { writeAudit } from "@/lib/audit";
import { ensureInvoicePublicToken } from "@/lib/estimates/token";
import { createStripeCheckoutSession } from "@/lib/payments/stripe";
import { stripeConfigured } from "@/lib/payments/provider";
import type { ActionResult } from "@/server/actions/auth";

function appUrl() {
  return process.env.APP_URL?.replace(/\/$/, "") || "http://127.0.0.1:43123";
}

export async function startInvoiceCheckoutAction(invoiceId: string): Promise<ActionResult> {
  try {
    const ctx = await requirePermission("invoices:manage");
    const { refuseDemoExternal } = await import("@/lib/demo/guard");
    const demo = await refuseDemoExternal(ctx.company.id);
    if (demo) return demo;
    if (!stripeConfigured()) {
      return { ok: false, error: "Card payments are not configured." };
    }
    const invoice = await prisma.invoice.findFirst({
      where: { id: invoiceId, companyId: ctx.company.id },
    });
    if (!invoice) return { ok: false, error: "Invoice not found." };
    if (invoice.balanceCents <= 0) return { ok: false, error: "This invoice has no balance due." };
    const token = await ensureInvoicePublicToken(prisma, invoice.id);
    const origin = appUrl();
    const session = await createStripeCheckoutSession(prisma, {
      invoiceNumber: invoice.invoiceNumber,
      invoiceId: invoice.id,
      companyId: invoice.companyId,
      amountCents: invoice.balanceCents,
      successUrl: `${origin}/i/${token}?paid=1`,
      cancelUrl: `${origin}/i/${token}?canceled=1`,
    });
    if (!session.ok) return { ok: false, error: session.error };
    await writeAudit({
      companyId: ctx.company.id,
      actorId: ctx.user.id,
      action: "payment.checkout_started",
      entityType: "Invoice",
      entityId: invoice.id,
      metadata: { provider: "STRIPE" },
    });
    redirect(session.url);
  } catch (e) {
    if (e instanceof AuthError) return { ok: false, error: e.message };
    throw e;
  }
}

export async function startPublicInvoiceCheckoutAction(token: string): Promise<ActionResult> {
  if (!stripeConfigured()) {
    return { ok: false, error: "Card payments are not configured." };
  }
  const invoice = await prisma.invoice.findFirst({ where: { publicToken: token } });
  if (!invoice) return { ok: false, error: "Invoice not found." };
  const { refuseDemoExternal } = await import("@/lib/demo/guard");
  const demo = await refuseDemoExternal(invoice.companyId);
  if (demo) return demo;
  if (invoice.balanceCents <= 0) return { ok: false, error: "This invoice has no balance due." };
  const origin = appUrl();
  const session = await createStripeCheckoutSession(prisma, {
    invoiceNumber: invoice.invoiceNumber,
    invoiceId: invoice.id,
    companyId: invoice.companyId,
    amountCents: invoice.balanceCents,
    successUrl: `${origin}/i/${token}?paid=1`,
    cancelUrl: `${origin}/i/${token}?canceled=1`,
  });
  if (!session.ok) return { ok: false, error: session.error };
  redirect(session.url);
}

export async function presentInvoiceAction(invoiceId: string): Promise<ActionResult> {
  try {
    const ctx = await requirePermission("invoices:manage");
    const invoice = await prisma.invoice.findFirst({
      where: { id: invoiceId, companyId: ctx.company.id },
    });
    if (!invoice) return { ok: false, error: "Invoice not found." };
    await ensureInvoicePublicToken(prisma, invoice.id);
    return { ok: true };
  } catch (e) {
    if (e instanceof AuthError) return { ok: false, error: e.message };
    throw e;
  }
}
