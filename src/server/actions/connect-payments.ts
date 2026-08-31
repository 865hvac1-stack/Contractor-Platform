"use server";

import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { AuthError } from "@/lib/auth";
import { isNextRedirect } from "@/lib/action-errors";
import { missingStripeEnvVars, stripeConfigured } from "@/lib/payments/config";
import {
  createAccountLoginLink,
  createAccountUpdateLink,
  createOrResumeConnectAccount,
  refreshConnectAccount,
} from "@/lib/payments/connect";
import { requirePermission } from "@/lib/tenant";
import type { ActionResult } from "@/server/actions/auth";

export async function startPaymentsOnboardingAction(): Promise<ActionResult> {
  try {
    const ctx = await requirePermission("payments:manage");
    if (!stripeConfigured()) {
      return {
        ok: false,
        error: `Payments are not configured. Missing ${missingStripeEnvVars().join(", ") || "STRIPE_SECRET_KEY"}.`,
      };
    }
    const started = await createOrResumeConnectAccount(prisma, {
      companyId: ctx.company.id,
      email: ctx.company.email,
      businessName: ctx.company.businessName,
    });
    await writeAudit({
      companyId: ctx.company.id,
      actorId: ctx.user.id,
      action: "payments.setup_started",
      entityType: "StripeConnectAccount",
      entityId: started.stripeAccountId,
    });
    redirect(started.url);
  } catch (error) {
    if (isNextRedirect(error)) throw error;
    if (error instanceof AuthError) return { ok: false, error: error.message };
    return { ok: false, error: error instanceof Error ? error.message : "Could not start payment setup." };
  }
}

export async function continuePaymentsSetupAction(): Promise<ActionResult> {
  return startPaymentsOnboardingAction();
}

export async function refreshPaymentsStatusAction(): Promise<ActionResult> {
  try {
    const ctx = await requirePermission("payments:manage");
    if (!stripeConfigured()) return { ok: false, error: "Payments are not configured." };
    await refreshConnectAccount(prisma, ctx.company.id);
    return { ok: true };
  } catch (error) {
    if (error instanceof AuthError) return { ok: false, error: error.message };
    return { ok: false, error: "Could not refresh payment status." };
  }
}

export async function manageStripeAccountAction(): Promise<ActionResult> {
  try {
    const ctx = await requirePermission("payments:manage");
    const account = await prisma.stripeConnectAccount.findUnique({ where: { companyId: ctx.company.id } });
    if (!account) return { ok: false, error: "Payments are not set up." };
    const link = await createAccountLoginLink(account.stripeAccountId);
    redirect(link.url);
  } catch (error) {
    if (isNextRedirect(error)) throw error;
    if (error instanceof AuthError) return { ok: false, error: error.message };
    return { ok: false, error: "Could not open the payment account." };
  }
}

export async function updateStripePayoutAccountAction(): Promise<ActionResult> {
  try {
    const ctx = await requirePermission("payments:manage");
    const account = await prisma.stripeConnectAccount.findUnique({ where: { companyId: ctx.company.id } });
    if (!account) return { ok: false, error: "Payments are not set up." };
    const link = await createAccountUpdateLink(account.stripeAccountId);
    redirect(link.url);
  } catch (error) {
    if (isNextRedirect(error)) throw error;
    if (error instanceof AuthError) return { ok: false, error: error.message };
    return { ok: false, error: "Could not open payout setup." };
  }
}

export async function disconnectPaymentsAction(): Promise<ActionResult> {
  try {
    const ctx = await requirePermission("payments:manage");
    const account = await prisma.stripeConnectAccount.findUnique({ where: { companyId: ctx.company.id } });
    if (!account) return { ok: true };
    await prisma.stripeConnectAccount.update({
      where: { id: account.id },
      data: { disabledAt: new Date(), onboardingStatus: "DISABLED" },
    });
    await writeAudit({
      companyId: ctx.company.id,
      actorId: ctx.user.id,
      action: "payments.disconnected",
      entityType: "StripeConnectAccount",
      entityId: account.stripeAccountId,
    });
    return { ok: true };
  } catch (error) {
    if (error instanceof AuthError) return { ok: false, error: error.message };
    return { ok: false, error: "Could not disconnect payments." };
  }
}
