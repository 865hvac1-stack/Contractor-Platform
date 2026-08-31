"use server";

import { prisma } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { AuthError } from "@/lib/auth";
import { missingStripeEnvVars, stripeConfigured } from "@/lib/payments/config";
import {
  createOrResumeConnectAccount,
  publicPaymentsError,
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
      action: started.created ? "payments.connected_account_created" : "payments.setup_resumed",
      entityType: "StripeConnectAccount",
      entityId: started.stripeAccountId,
    });
    return { ok: true };
  } catch (error) {
    if (error instanceof AuthError) return { ok: false, error: error.message };
    const safe = publicPaymentsError(error);
    console.error("[payments.connect]", safe.diagnostic);
    return { ok: false, error: "Unable to start payment setup. Please try again.", diagnostic: safe.diagnostic };
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
    return { ok: false, error: publicPaymentsError(error).user };
  }
}

export async function manageStripeAccountAction(): Promise<ActionResult> {
  return startPaymentsOnboardingAction();
}

export async function updateStripePayoutAccountAction(): Promise<ActionResult> {
  return startPaymentsOnboardingAction();
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
