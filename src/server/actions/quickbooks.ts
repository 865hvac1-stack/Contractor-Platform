"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { AuthError } from "@/lib/auth";
import { requirePermission } from "@/lib/tenant";
import { deleteConnectionCredentials, getCompanyConnection, upsertConnection } from "@/lib/integrations/store";
import type { ActionResult } from "@/server/actions/auth";
import { parseQuickBooksEnvironment, QUICKBOOKS_PROVIDER_KEY } from "@/lib/quickbooks/config";
import { clearCompanyQuickBooksApp, loadQuickBooksAppCredentials, saveCompanyQuickBooksApp } from "@/lib/quickbooks/app";
import { getQuickBooksSettings, loadQuickBooksTransport } from "@/lib/quickbooks/connection";
import { revokeQuickBooksToken } from "@/lib/quickbooks/oauth";
import { loadConnectionTokens } from "@/lib/integrations/store";
import { canAutoSyncInvoice, syncInvoiceToQuickBooks, syncPaymentToQuickBooks } from "@/lib/quickbooks/sync";
import type { QuickBooksInvoiceTrigger } from "@prisma/client";

export async function saveQuickBooksSettingsAction(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  try {
    const ctx = await requirePermission("accounting:manage");
    const { refuseDemoExternal } = await import("@/lib/demo/guard");
    const demo = await refuseDemoExternal(ctx.company.id);
    if (demo) return demo;
    const trigger = String(formData.get("invoiceSyncTrigger") || "MANUAL_ONLY") as QuickBooksInvoiceTrigger;
    const allowed: QuickBooksInvoiceTrigger[] = [
      "MANUAL_ONLY",
      "WHEN_CREATED",
      "WHEN_SENT",
      "WHEN_JOB_COMPLETED",
      "WHEN_PAYMENT_RECEIVED",
    ];
    if (!allowed.includes(trigger)) return { ok: false, error: "Choose a valid sync setting." };
    await prisma.quickBooksSettings.upsert({
      where: { companyId: ctx.company.id },
      create: { companyId: ctx.company.id, invoiceSyncTrigger: trigger },
      update: { invoiceSyncTrigger: trigger },
    });
    await writeAudit({
      companyId: ctx.company.id,
      actorId: ctx.user.id,
      action: "quickbooks.settings_updated",
      entityType: "QuickBooksSettings",
      metadata: { trigger },
    });
    revalidatePath("/settings/quickbooks");
    return { ok: true };
  } catch (error) {
    if (error instanceof AuthError) return { ok: false, error: error.message };
    return { ok: false, error: "Could not save that setting." };
  }
}

export async function saveQuickBooksAppAction(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  try {
    const ctx = await requirePermission("accounting:manage");
    const { refuseDemoExternal } = await import("@/lib/demo/guard");
    const demo = await refuseDemoExternal(ctx.company.id);
    if (demo) return demo;
    const clientId = String(formData.get("clientId") || "");
    const clientSecret = String(formData.get("clientSecret") || "");
    const environment = parseQuickBooksEnvironment(String(formData.get("environment") || "sandbox"));
    await saveCompanyQuickBooksApp(prisma, ctx.company.id, {
      clientId,
      clientSecret: clientSecret || undefined,
      environment,
    });
    await writeAudit({
      companyId: ctx.company.id,
      actorId: ctx.user.id,
      action: "quickbooks.app_saved",
      entityType: "QuickBooksSettings",
      metadata: { environment, clientIdPresent: Boolean(clientId.trim()) },
    });
    revalidatePath("/settings/quickbooks");
    return { ok: true, message: "Intuit app keys saved. You can connect QuickBooks now." };
  } catch (error) {
    if (error instanceof AuthError) return { ok: false, error: error.message };
    return { ok: false, error: error instanceof Error ? error.message : "Could not save those Intuit keys." };
  }
}

export async function clearQuickBooksAppAction(): Promise<ActionResult> {
  try {
    const ctx = await requirePermission("accounting:manage");
    await clearCompanyQuickBooksApp(prisma, ctx.company.id);
    await writeAudit({
      companyId: ctx.company.id,
      actorId: ctx.user.id,
      action: "quickbooks.app_cleared",
      entityType: "QuickBooksSettings",
    });
    revalidatePath("/settings/quickbooks");
    return { ok: true };
  } catch (error) {
    if (error instanceof AuthError) return { ok: false, error: error.message };
    return { ok: false, error: "Could not remove those Intuit keys." };
  }
}

export async function disconnectQuickBooksAction(): Promise<ActionResult> {
  try {
    const ctx = await requirePermission("accounting:manage");
    const connection = await getCompanyConnection(ctx.company.id, QUICKBOOKS_PROVIDER_KEY);
    const app = await loadQuickBooksAppCredentials(prisma, ctx.company.id);
    if (connection) {
      const tokens = await loadConnectionTokens(ctx.company.id, connection.id);
      if (tokens?.refreshToken) await revokeQuickBooksToken(tokens.refreshToken, app);
      else if (tokens?.accessToken) await revokeQuickBooksToken(tokens.accessToken, app);
      await deleteConnectionCredentials(ctx.company.id, connection.id);
    }
    await upsertConnection({
      companyId: ctx.company.id,
      providerKey: QUICKBOOKS_PROVIDER_KEY,
      status: "NOT_CONNECTED",
      accountLabel: null,
      externalAccountId: null,
      healthMessage: "Disconnected. Invoice history and mappings stay in ContractorYou.",
      errorMessage: null,
    });
    await writeAudit({
      companyId: ctx.company.id,
      actorId: ctx.user.id,
      action: "quickbooks.disconnected",
      entityType: "IntegrationConnection",
      entityId: connection?.id,
    });
    revalidatePath("/settings/quickbooks");
    return { ok: true };
  } catch (error) {
    if (error instanceof AuthError) return { ok: false, error: error.message };
    return { ok: false, error: "Could not disconnect QuickBooks." };
  }
}

export async function syncInvoiceToQuickBooksAction(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  try {
    const ctx = await requirePermission("accounting:manage");
    const invoiceId = String(formData.get("invoiceId") || "");
    const loaded = await loadQuickBooksTransport(ctx.company.id);
    if (!loaded.ok) return { ok: false, error: loaded.error };
    const result = await syncInvoiceToQuickBooks(prisma, loaded.transport, {
      companyId: ctx.company.id,
      invoiceId,
      actorId: ctx.user.id,
    });
    await writeAudit({
      companyId: ctx.company.id,
      actorId: ctx.user.id,
      action: result.ok ? "quickbooks.invoice_synced" : "quickbooks.invoice_failed",
      entityType: "Invoice",
      entityId: invoiceId,
      metadata: { quickbooksId: result.quickbooksId ?? null },
    });
    revalidatePath(`/invoices/${invoiceId}`);
    revalidatePath("/settings/quickbooks");
    return result.ok ? { ok: true } : { ok: false, error: result.error ?? "Could not sync that invoice." };
  } catch (error) {
    if (error instanceof AuthError) return { ok: false, error: error.message };
    return { ok: false, error: "Could not sync that invoice." };
  }
}

export async function syncPaymentToQuickBooksAction(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  try {
    const ctx = await requirePermission("accounting:manage");
    const paymentId = String(formData.get("paymentId") || "");
    const loaded = await loadQuickBooksTransport(ctx.company.id);
    if (!loaded.ok) return { ok: false, error: loaded.error };
    const result = await syncPaymentToQuickBooks(prisma, loaded.transport, {
      companyId: ctx.company.id,
      paymentId,
    });
    await writeAudit({
      companyId: ctx.company.id,
      actorId: ctx.user.id,
      action: result.ok ? "quickbooks.payment_synced" : "quickbooks.payment_failed",
      entityType: "Payment",
      entityId: paymentId,
    });
    revalidatePath("/invoices");
    return result.ok ? { ok: true } : { ok: false, error: result.error ?? "Could not sync that payment." };
  } catch (error) {
    if (error instanceof AuthError) return { ok: false, error: error.message };
    return { ok: false, error: "Could not sync that payment." };
  }
}

export async function maybeAutoSyncInvoice(input: {
  companyId: string;
  invoiceId: string;
  actorId: string;
  event: "created" | "sent" | "job_completed" | "payment_received";
  importMode?: string | null;
}) {
  const settings = await getQuickBooksSettings(input.companyId);
  const gate = canAutoSyncInvoice({
    trigger: settings.invoiceSyncTrigger,
    event: input.event,
    importMode: input.importMode,
  });
  if (!gate.allowed) return;
  const loaded = await loadQuickBooksTransport(input.companyId);
  if (!loaded.ok) return;
  await syncInvoiceToQuickBooks(prisma, loaded.transport, input);
}

export async function maybeAutoSyncPayment(input: {
  companyId: string;
  paymentId: string;
  importMode?: string | null;
}) {
  if (input.importMode === "HISTORICAL") return;
  const settings = await getQuickBooksSettings(input.companyId);
  if (settings.invoiceSyncTrigger !== "WHEN_PAYMENT_RECEIVED") return;
  const loaded = await loadQuickBooksTransport(input.companyId);
  if (!loaded.ok) return;
  const invoiceMap = await prisma.quickBooksMapping.findFirst({
    where: {
      companyId: input.companyId,
      entityType: "INVOICE",
      internalId: (
        await prisma.payment.findFirst({
          where: { id: input.paymentId, companyId: input.companyId },
          select: { invoiceId: true },
        })
      )?.invoiceId,
    },
  });
  if (!invoiceMap) return;
  await syncPaymentToQuickBooks(prisma, loaded.transport, input);
}
