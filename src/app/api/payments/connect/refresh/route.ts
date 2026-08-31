import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { stripeConfigured } from "@/lib/payments/config";
import { createOrResumeConnectAccount } from "@/lib/payments/connect";
import { requirePermission } from "@/lib/tenant";

export async function GET() {
  const ctx = await requirePermission("payments:manage");
  if (!stripeConfigured()) redirect("/settings/payments");
  const started = await createOrResumeConnectAccount(prisma, {
    companyId: ctx.company.id,
    email: ctx.company.email,
    businessName: ctx.company.businessName,
  });
  redirect(started.url);
}
