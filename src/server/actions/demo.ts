"use server";

import { revalidatePath } from "next/cache";
import { requirePlatformAdmin } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { SUMMIT_COMPANY_NAME } from "@/lib/demo/constants";
import { resetSummitDemoCompany } from "@/lib/demo/seed-summit";
import type { ActionResult } from "@/server/actions/auth";

export async function resetSummitDemoAction(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  await requirePlatformAdmin();
  const confirm = String(formData.get("confirm") || "").trim();
  if (confirm !== "RESET SUMMIT DEMO") {
    return { ok: false, error: "Type RESET SUMMIT DEMO to confirm. This never targets 865 HVAC or other tenants." };
  }
  const existing = await prisma.company.findFirst({
    where: { isDemo: true, businessName: SUMMIT_COMPANY_NAME },
    select: { id: true, isDemo: true, businessName: true },
  });
  if (existing && (!existing.isDemo || existing.businessName !== SUMMIT_COMPANY_NAME)) {
    return { ok: false, error: "Refusing to reset a non-demo company." };
  }
  const result = await resetSummitDemoCompany(prisma);
  revalidatePath("/platform");
  revalidatePath(`/platform/companies/${result.companyId}`);
  return {
    ok: true,
    message: `Summit Home Services reset. ${result.customers} customers, ${result.todayJobs} jobs today, ${result.estimates} estimates.`,
  };
}
