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
import { canAutoSyncInvoice, syncExpenseToQuickBooks, syncInvoiceToQuickBooks, syncPaymentToQuickBooks } from "@/lib/quickbooks/sync";
import { runQuickBooksSync } from "@/lib/quickbooks/engine";
import { verifyQuickBooksCompany } from "@/lib/quickbooks/verify";
import { resolveSyncStartDate, type SyncStartOption } from "@/lib/quickbooks/dates";
import { qboCreateCustomer, qboListExpenseAccounts, qboListItems, qboSearchCustomers } from "@/lib/quickbooks/client";
import { upsertMapping } from "@/lib/quickbooks/sync";
import { saveCompanyItemMappings } from "@/lib/quickbooks/mappings";
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
    revalidatePath("/settings/quickbooks/manage");
    revalidatePath("/money");
    return { ok: true };
  } catch (error) {
    if (error instanceof AuthError) return { ok: false, error: error.message };
    return { ok: false, error: "Could not disconnect QuickBooks." };
  }
}

export async function refreshQuickBooksCompanyAction(
  _prev?: ActionResult | null,
  _formData?: FormData
): Promise<ActionResult> {
  try {
    const ctx = await requirePermission("accounting:manage");
    const verified = await verifyQuickBooksCompany(prisma, ctx.company.id);
    revalidatePath("/settings/quickbooks");
    revalidatePath("/settings/quickbooks/setup");
    return verified.ok
      ? { ok: true, message: `Verified ${verified.name}.` }
      : { ok: false, error: verified.error };
  } catch (error) {
    if (error instanceof AuthError) return { ok: false, error: error.message };
    return { ok: false, error: "Could not verify that QuickBooks company." };
  }
}

export async function syncNowQuickBooksAction(
  _prev?: ActionResult | null,
  _formData?: FormData
): Promise<ActionResult> {
  try {
    const ctx = await requirePermission("accounting:manage");
    const { refuseDemoExternal } = await import("@/lib/demo/guard");
    const demo = await refuseDemoExternal(ctx.company.id);
    if (demo) return demo;
    const settings = await getQuickBooksSettings(ctx.company.id);
    const result = await runQuickBooksSync(prisma, {
      companyId: ctx.company.id,
      actorId: ctx.user.id,
      push: settings.syncActivated,
    });
    await writeAudit({
      companyId: ctx.company.id,
      actorId: ctx.user.id,
      action: settings.syncActivated ? "quickbooks.sync_now" : "quickbooks.sync_preview",
      entityType: "QuickBooksSettings",
      metadata: {
        pushed: result.pushed,
        activated: result.activated,
        eligible: {
          invoices: result.preview.invoicesEligible,
          payments: result.preview.paymentsEligible,
          expenses: result.preview.expensesEligible,
        },
      },
    });
    revalidatePath("/settings/quickbooks");
    revalidatePath("/settings/quickbooks/manage");
    if (!settings.syncActivated) {
      return {
        ok: true,
        message: `Safe mode preview: ${result.preview.invoicesEligible} invoices, ${result.preview.paymentsEligible} payments, ${result.preview.expensesEligible} expenses eligible. Finish setup to activate automatic sync.`,
      };
    }
    return {
      ok: true,
      message: `Synced ${result.pushed.invoices} invoices, ${result.pushed.payments} payments, ${result.pushed.expenses} expenses.`,
    };
  } catch (error) {
    if (error instanceof AuthError) return { ok: false, error: error.message };
    return { ok: false, error: "Could not run QuickBooks sync." };
  }
}

export async function saveQuickBooksWizardAction(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  try {
    const ctx = await requirePermission("accounting:manage");
    const option = String(formData.get("syncStartOption") || "month") as SyncStartOption;
    const custom = String(formData.get("customDate") || "");
    const trigger = String(formData.get("invoiceSyncTrigger") || "MANUAL_ONLY") as QuickBooksInvoiceTrigger;
    const activate = String(formData.get("activate") || "") === "yes";
    const syncStartDate = resolveSyncStartDate(option, custom);
    await prisma.quickBooksSettings.upsert({
      where: { companyId: ctx.company.id },
      create: {
        companyId: ctx.company.id,
        invoiceSyncTrigger: trigger,
        syncStartDate,
        syncActivated: activate,
        wizardCompletedAt: activate ? new Date() : null,
      },
      update: {
        invoiceSyncTrigger: trigger,
        syncStartDate,
        syncActivated: activate ? true : undefined,
        wizardCompletedAt: activate ? new Date() : undefined,
      },
    });
    await writeAudit({
      companyId: ctx.company.id,
      actorId: ctx.user.id,
      action: activate ? "quickbooks.wizard_completed" : "quickbooks.wizard_saved",
      entityType: "QuickBooksSettings",
      metadata: { option, trigger, activate },
    });
    revalidatePath("/settings/quickbooks");
    revalidatePath("/settings/quickbooks/setup");
    revalidatePath("/settings/quickbooks/manage");
    return {
      ok: true,
      message: activate
        ? "Automatic sync is on. Historical records still stay put until you choose them."
        : "Setup saved. Automatic sync is still off.",
    };
  } catch (error) {
    if (error instanceof AuthError) return { ok: false, error: error.message };
    return { ok: false, error: "Could not save QuickBooks setup." };
  }
}

export async function saveQuickBooksItemMappingsAction(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  try {
    const ctx = await requirePermission("accounting:manage");
    const defaultItemId = String(formData.get("defaultItemId") || "").trim();
    const expenseAccountId = String(formData.get("expenseAccountId") || "").trim();
    const serviceItems = [...formData.entries()].flatMap(([key, value]) => {
      if (!key.startsWith("serviceItem:") || typeof value !== "string" || !value.trim()) return [];
      return [{ serviceTypeId: key.slice("serviceItem:".length), quickbooksId: value.trim() }];
    });
    const loaded = await loadQuickBooksTransport(ctx.company.id);
    const connection = await getCompanyConnection(ctx.company.id, QUICKBOOKS_PROVIDER_KEY);
    const activeItems = loaded.ok ? await qboListItems(loaded.transport) : [];
    const activeAccounts = loaded.ok ? await qboListExpenseAccounts(loaded.transport) : [];
    const saved = await saveCompanyItemMappings(prisma, {
      companyId: ctx.company.id,
      realmId: connection?.externalAccountId,
      defaultItemId,
      serviceItems,
      expenseAccountId,
      activeItems: activeItems.length ? activeItems : undefined,
      activeAccounts: activeAccounts.length ? activeAccounts : undefined,
    });
    if (!saved.ok) return { ok: false, error: saved.error };
    const trigger = String(formData.get("invoiceSyncTrigger") || "") as QuickBooksInvoiceTrigger;
    if (
      trigger &&
      ["MANUAL_ONLY", "WHEN_CREATED", "WHEN_SENT", "WHEN_JOB_COMPLETED", "WHEN_PAYMENT_RECEIVED"].includes(trigger)
    ) {
      await prisma.quickBooksSettings.upsert({
        where: { companyId: ctx.company.id },
        create: { companyId: ctx.company.id, invoiceSyncTrigger: trigger },
        update: { invoiceSyncTrigger: trigger },
      });
    }
    await writeAudit({
      companyId: ctx.company.id,
      actorId: ctx.user.id,
      action: "quickbooks.mappings_saved",
      entityType: "QuickBooksSettings",
    });
    revalidatePath("/settings/quickbooks/setup");
    revalidatePath("/settings/quickbooks/manage");
    return { ok: true, message: "QuickBooks Product/Service mappings saved." };
  } catch (error) {
    if (error instanceof AuthError) return { ok: false, error: error.message };
    return { ok: false, error: "Could not save those mappings." };
  }
}

export async function linkQuickBooksCustomerAction(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  try {
    const ctx = await requirePermission("accounting:manage");
    const customerId = String(formData.get("customerId") || "");
    const quickbooksId = String(formData.get("quickbooksId") || "").trim();
    const customer = await prisma.customer.findFirst({
      where: { id: customerId, companyId: ctx.company.id },
      select: { id: true },
    });
    if (!customer || !quickbooksId) return { ok: false, error: "Choose a QuickBooks customer to link." };
    await upsertMapping(prisma, {
      companyId: ctx.company.id,
      entityType: "CUSTOMER",
      internalId: customer.id,
      quickbooksId,
    });
    await writeAudit({
      companyId: ctx.company.id,
      actorId: ctx.user.id,
      action: "quickbooks.customer_linked",
      entityType: "Customer",
      entityId: customer.id,
    });
    revalidatePath("/settings/quickbooks/manage");
    return { ok: true, message: "Customer linked." };
  } catch (error) {
    if (error instanceof AuthError) return { ok: false, error: error.message };
    return { ok: false, error: "Could not link that customer." };
  }
}

export async function createQuickBooksCustomerAction(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  try {
    const ctx = await requirePermission("accounting:manage");
    const customerId = String(formData.get("customerId") || "");
    const customer = await prisma.customer.findFirst({
      where: { id: customerId, companyId: ctx.company.id },
    });
    if (!customer) return { ok: false, error: "Customer not found." };
    const loaded = await loadQuickBooksTransport(ctx.company.id);
    if (!loaded.ok) return { ok: false, error: loaded.error };
    const display = customer.businessName || `${customer.firstName} ${customer.lastName}`.trim() || "Customer";
    const existing = await qboSearchCustomers(loaded.transport, {
      displayName: display,
      email: customer.email,
    });
    if (existing.length) {
      return { ok: false, error: "A similar QuickBooks customer already exists. Link it instead of creating another." };
    }
    const qbId = await qboCreateCustomer(loaded.transport, {
      displayName: display,
      firstName: customer.firstName,
      lastName: customer.lastName,
      email: customer.email,
      phone: customer.phone,
    });
    await upsertMapping(prisma, {
      companyId: ctx.company.id,
      entityType: "CUSTOMER",
      internalId: customer.id,
      quickbooksId: qbId,
    });
    await writeAudit({
      companyId: ctx.company.id,
      actorId: ctx.user.id,
      action: "quickbooks.customer_created",
      entityType: "Customer",
      entityId: customer.id,
    });
    revalidatePath("/settings/quickbooks/manage");
    return { ok: true, message: "Customer created in QuickBooks." };
  } catch (error) {
    if (error instanceof AuthError) return { ok: false, error: error.message };
    return { ok: false, error: "Could not create that QuickBooks customer." };
  }
}

export async function unlinkQuickBooksCustomerAction(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  try {
    const ctx = await requirePermission("accounting:manage");
    const customerId = String(formData.get("customerId") || "");
    const invoiceMaps = await prisma.quickBooksMapping.count({
      where: {
        companyId: ctx.company.id,
        entityType: "INVOICE",
        status: "SYNCED",
        internalId: {
          in: (
            await prisma.invoice.findMany({
              where: { companyId: ctx.company.id, customerId },
              select: { id: true },
            })
          ).map((row) => row.id),
        },
      },
    });
    if (invoiceMaps > 0) {
      return { ok: false, error: "Unlink invoices first. This customer already has synced invoices." };
    }
    await prisma.quickBooksMapping.deleteMany({
      where: { companyId: ctx.company.id, entityType: "CUSTOMER", internalId: customerId },
    });
    await writeAudit({
      companyId: ctx.company.id,
      actorId: ctx.user.id,
      action: "quickbooks.customer_unlinked",
      entityType: "Customer",
      entityId: customerId,
    });
    revalidatePath("/settings/quickbooks/manage");
    return { ok: true, message: "Customer unlinked." };
  } catch (error) {
    if (error instanceof AuthError) return { ok: false, error: error.message };
    return { ok: false, error: "Could not unlink that customer." };
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

export async function syncExpenseToQuickBooksAction(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  try {
    const ctx = await requirePermission("accounting:manage");
    const expenseId = String(formData.get("expenseId") || "");
    const loaded = await loadQuickBooksTransport(ctx.company.id);
    if (!loaded.ok) return { ok: false, error: loaded.error };
    const result = await syncExpenseToQuickBooks(prisma, loaded.transport, {
      companyId: ctx.company.id,
      expenseId,
    });
    await writeAudit({
      companyId: ctx.company.id,
      actorId: ctx.user.id,
      action: result.ok ? "quickbooks.expense_synced" : "quickbooks.expense_failed",
      entityType: "Expense",
      entityId: expenseId,
    });
    revalidatePath(`/expenses/${expenseId}`);
    revalidatePath("/settings/quickbooks/manage");
    return result.ok ? { ok: true } : { ok: false, error: result.error ?? "Could not sync that expense." };
  } catch (error) {
    if (error instanceof AuthError) return { ok: false, error: error.message };
    return { ok: false, error: "Could not sync that expense." };
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
  if (!settings.syncActivated) return;
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
  if (!settings.syncActivated) return;
  if (settings.invoiceSyncTrigger !== "WHEN_PAYMENT_RECEIVED") return;
  const loaded = await loadQuickBooksTransport(input.companyId);
  if (!loaded.ok) return;
  const payment = await prisma.payment.findFirst({
    where: { id: input.paymentId, companyId: input.companyId },
    include: {
      invoice: {
        select: {
          id: true,
          invoiceNumber: true,
          status: true,
          issueDate: true,
          importMode: true,
          totalCents: true,
        },
      },
    },
  });
  if (!payment) return;
  const siblings = await prisma.payment.findMany({
    where: { companyId: input.companyId, invoiceId: payment.invoiceId },
    select: {
      id: true,
      invoiceId: true,
      paidAt: true,
      importMode: true,
      status: true,
      amountCents: true,
      refundedCents: true,
      provider: true,
      providerPaymentId: true,
    },
  });
  const { ENTITY_INVOICE, ENTITY_PAYMENT } = await import("@/lib/quickbooks/mappings");
  const {
    evaluateInvoiceEligibility,
    evaluatePaymentEligibility,
    mappingKey,
  } = await import("@/lib/quickbooks/eligibility");
  const { syncPaymentWithInvoiceDependency } = await import("@/lib/quickbooks/engine");
  const mappings = await prisma.quickBooksMapping.findMany({
    where: {
      companyId: input.companyId,
      entityType: { in: [ENTITY_INVOICE, ENTITY_PAYMENT] },
    },
    select: { entityType: true, internalId: true, status: true, quickbooksId: true },
  });
  const map = new Map(mappings.map((row) => [mappingKey(row.entityType, row.internalId), row]));
  const invoiceEligibility = payment.invoice
    ? evaluateInvoiceEligibility(payment.invoice, {
        syncStartDate: settings.syncStartDate,
        mapping: map.get(mappingKey(ENTITY_INVOICE, payment.invoice.id)),
      })
    : null;
  const eligibility = evaluatePaymentEligibility({
    payment,
    invoice: payment.invoice,
    siblingPayments: siblings,
    paymentMapping: map.get(mappingKey(ENTITY_PAYMENT, payment.id)),
    invoiceMapping: payment.invoice ? map.get(mappingKey(ENTITY_INVOICE, payment.invoice.id)) : null,
    syncedPaymentIds: mappings.filter((row) => row.entityType === ENTITY_PAYMENT && row.status === "SYNCED").map((row) => row.internalId),
    syncStartDate: settings.syncStartDate,
  });
  if (!eligibility.canAutoSync || !payment.invoice || !invoiceEligibility) return;
  await syncPaymentWithInvoiceDependency(prisma, loaded.transport, {
    companyId: input.companyId,
    actorId: "payment-provider",
    paymentId: payment.id,
    invoiceId: payment.invoice.id,
    invoiceCanSyncAsDependency: invoiceEligibility.canSyncAsDependency,
    invoiceHasValidMapping: invoiceEligibility.hasValidMapping,
  });
}
