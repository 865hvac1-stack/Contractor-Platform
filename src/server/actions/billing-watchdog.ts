"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { requirePermission } from "@/lib/tenant";
import { AuthError } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { excludeWatchdogFinding } from "@/lib/billing-watchdog/persist";
import { refreshBillingWatchdog } from "@/lib/billing-watchdog/service";
import { saveBillingWatchdogSettings } from "@/lib/billing-watchdog/settings";
import { BILLING_WATCHDOG_EXCLUSION_CODES } from "@/lib/billing-watchdog/types";
import type { ActionResult } from "@/server/actions/auth";

export async function refreshBillingWatchdogAction(): Promise<ActionResult> {
  try {
    const ctx = await requirePermission("invoices:view");
    await refreshBillingWatchdog(prisma, ctx.company.id);
    revalidatePath("/billing-watchdog");
    revalidatePath("/dashboard");
    revalidatePath("/money");
    return { ok: true };
  } catch (error) {
    if (error instanceof AuthError) return { ok: false, error: error.message };
    return { ok: false, error: "Could not refresh Billing Watchdog." };
  }
}

export async function excludeBillingWatchdogFindingAction(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  try {
    const ctx = await requirePermission("invoices:manage");
    const findingId = String(formData.get("findingId") || "");
    const code = String(formData.get("exclusionCode") || "");
    const reason = String(formData.get("reason") || "").trim();
    if (!findingId) return { ok: false, error: "Finding is required." };
    if (!BILLING_WATCHDOG_EXCLUSION_CODES.includes(code as (typeof BILLING_WATCHDOG_EXCLUSION_CODES)[number])) {
      return { ok: false, error: "Choose a valid exclusion reason." };
    }
    if (!reason) return { ok: false, error: "Add a short reason so the exception is auditable." };
    const finding = await prisma.billingWatchdogFinding.findFirst({
      where: { id: findingId, companyId: ctx.company.id },
    });
    if (!finding) return { ok: false, error: "Finding not found." };
    await excludeWatchdogFinding(prisma, {
      companyId: ctx.company.id,
      findingId,
      actorId: ctx.user.id,
      code,
      reason,
    });
    await writeAudit({
      companyId: ctx.company.id,
      actorId: ctx.user.id,
      action: "billing_watchdog.excluded",
      entityType: "BillingWatchdogFinding",
      entityId: findingId,
      metadata: { code, reason, type: finding.type, jobId: finding.jobId, invoiceId: finding.invoiceId },
    });
    revalidatePath("/billing-watchdog");
    revalidatePath("/dashboard");
    return { ok: true };
  } catch (error) {
    if (error instanceof AuthError) return { ok: false, error: error.message };
    return { ok: false, error: "Could not exclude that finding." };
  }
}

export async function saveBillingWatchdogSettingsAction(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  try {
    const ctx = await requirePermission("company:settings");
    if (!can(ctx.role, "company:settings")) return { ok: false, error: "You cannot change these settings." };
    const start = String(formData.get("startDate") || "");
    const startDate = start ? new Date(`${start}T00:00:00`) : undefined;
    await saveBillingWatchdogSettings(prisma, ctx.company.id, {
      startDate: startDate && !Number.isNaN(startDate.getTime()) ? startDate : undefined,
      checkoutGraceMinutes: Number(formData.get("checkoutGraceMinutes") || 120),
      completedInvoiceGraceHours: Number(formData.get("completedInvoiceGraceHours") || 8),
      invoiceSendGraceHours: Number(formData.get("invoiceSendGraceHours") || 4),
      accountingSyncGraceHours: Number(formData.get("accountingSyncGraceHours") || 24),
      morningSummaryEnabled: formData.get("morningSummaryEnabled") === "on",
    });
    await writeAudit({
      companyId: ctx.company.id,
      actorId: ctx.user.id,
      action: "billing_watchdog.settings_saved",
      entityType: "BillingWatchdogSettings",
      entityId: ctx.company.id,
    });
    revalidatePath("/settings/billing-watchdog");
    revalidatePath("/billing-watchdog");
    return { ok: true };
  } catch (error) {
    if (error instanceof AuthError) return { ok: false, error: error.message };
    return { ok: false, error: "Could not save Billing Watchdog settings." };
  }
}
