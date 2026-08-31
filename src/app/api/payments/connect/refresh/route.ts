import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { stripeConfigured } from "@/lib/payments/config";
import { createOrResumeConnectAccount } from "@/lib/payments/connect";
import { requirePermission } from "@/lib/tenant";

/** Resume in-app embedded onboarding. Never redirect the contractor to Stripe-hosted Account Links. */
export async function GET() {
  const ctx = await requirePermission("payments:manage");
  if (!stripeConfigured()) redirect("/settings/payments");
  await createOrResumeConnectAccount(prisma, {
    companyId: ctx.company.id,
    email: ctx.company.email,
    businessName: ctx.company.businessName,
  });
  redirect("/settings/payments?onboard=1");
}
