import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { AuthError } from "@/lib/auth";
import { stripeConfigured, stripePublishableKey } from "@/lib/payments/config";
import {
  createOnboardingAccountSession,
  createOrResumeConnectAccount,
  publicPaymentsError,
} from "@/lib/payments/connect";
import { requirePermission } from "@/lib/tenant";

/** Account Session client_secret for Connect embedded Account Onboarding. */
export async function POST() {
  try {
    // Tenant comes from the signed-in membership only. Never read companyId from the request body.
    const ctx = await requirePermission("payments:manage");
    if (!stripeConfigured() || !stripePublishableKey()) {
      return NextResponse.json(
        { ok: false, error: "Payments are not configured." },
        { status: 503 }
      );
    }
    const started = await createOrResumeConnectAccount(prisma, {
      companyId: ctx.company.id,
      email: ctx.company.email,
      businessName: ctx.company.businessName,
    });
    const session = await createOnboardingAccountSession(started.stripeAccountId);
    if (!session.client_secret) {
      return NextResponse.json(
        { ok: false, error: "ContractorYou Payments couldn't start setup. Please try again or contact your administrator." },
        { status: 502 }
      );
    }
    return NextResponse.json({ ok: true, clientSecret: session.client_secret });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 401 });
    }
    const safe = publicPaymentsError(error);
    console.error("[payments.account_session]", safe.diagnostic);
    return NextResponse.json({ ok: false, error: safe.user, diagnostic: safe.diagnostic }, { status: 502 });
  }
}
