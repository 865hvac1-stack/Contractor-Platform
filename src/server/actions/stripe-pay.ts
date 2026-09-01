"use server";

import { prisma } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { AuthError } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { jobAccessFilter, requirePermission } from "@/lib/tenant";
import { requireStripe } from "@/lib/payments/stripe-client";
import type { ActionResult } from "@/server/actions/auth";

export async function refundPaymentAction(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  try {
    const ctx = await requirePermission("payments:refund");
    const { demoOutboundBlock } = await import("@/lib/demo/guard");
    const blocked = await demoOutboundBlock(ctx.company.id);
    if (blocked.blocked) return { ok: false, error: blocked.message };
    const paymentId = String(formData.get("paymentId") || "");
    const amountDollars = Number(formData.get("amount") || "0");
    const confirm = String(formData.get("confirm") || "") === "yes";
    if (!confirm) return { ok: false, error: "Confirm the refund to continue." };
    const payment = await prisma.payment.findFirst({
      where: { id: paymentId, companyId: ctx.company.id },
    });
    if (!payment) return { ok: false, error: "Payment not found." };
    if (payment.provider !== "STRIPE" || !payment.providerPaymentId) {
      return { ok: false, error: "Only electronic payments can be refunded through ContractorYou Payments." };
    }
    const remaining = payment.amountCents - payment.refundedCents;
    const amountCents = amountDollars > 0 ? Math.round(amountDollars * 100) : remaining;
    if (amountCents <= 0 || amountCents > remaining) {
      return { ok: false, error: "Refund amount is not valid." };
    }
    if (!payment.stripeAccountId) {
      return { ok: false, error: "This payment is missing its connected account." };
    }
    const stripe = requireStripe();
    await stripe.refunds.create(
      {
        payment_intent: payment.providerPaymentId,
        amount: amountCents,
        metadata: { companyId: ctx.company.id, paymentId: payment.id },
      },
      { stripeAccount: payment.stripeAccountId }
    );
    await writeAudit({
      companyId: ctx.company.id,
      actorId: ctx.user.id,
      action: "payment.refund_requested",
      entityType: "Payment",
      entityId: payment.id,
      metadata: { amountCents },
    });
    return { ok: true, message: "Refund submitted. Status updates when Stripe confirms it." };
  } catch (error) {
    if (error instanceof AuthError) return { ok: false, error: error.message };
    return { ok: false, error: error instanceof Error ? error.message : "Refund failed." };
  }
}

export async function assertCanCollectInvoice(role: Parameters<typeof can>[0], userId: string, invoiceJobId: string | null) {
  if (can(role, "invoices:manage")) return true;
  if (can(role, "invoices:field") && invoiceJobId) {
    const assigned = await prisma.job.findFirst({
      where: { id: invoiceJobId, ...jobAccessFilter(role, userId) },
      select: { id: true },
    });
    return Boolean(assigned);
  }
  return false;
}
