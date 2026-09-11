import type { PrismaClient } from "@prisma/client";
import type { BillingWatchdogSettingsView } from "@/lib/billing-watchdog/types";

export const DEFAULT_WATCHDOG_SETTINGS: Omit<BillingWatchdogSettingsView, "startDate"> = {
  checkoutGraceMinutes: 120,
  completedInvoiceGraceHours: 8,
  invoiceSendGraceHours: 4,
  accountingSyncGraceHours: 24,
  morningSummaryEnabled: false,
  morningSummaryRoles: ["COMPANY_OWNER", "ADMIN", "MANAGER", "OFFICE"],
};

export function defaultWatchdogStartDate(now = new Date()) {
  return new Date(now.getFullYear(), now.getMonth(), 1);
}

export async function getBillingWatchdogSettings(
  prisma: PrismaClient,
  companyId: string,
  now = new Date()
): Promise<BillingWatchdogSettingsView> {
  const row = await prisma.billingWatchdogSettings.findUnique({ where: { companyId } });
  if (!row) {
    return { ...DEFAULT_WATCHDOG_SETTINGS, startDate: defaultWatchdogStartDate(now) };
  }
  const roles = Array.isArray(row.morningSummaryRoles)
    ? (row.morningSummaryRoles as string[])
    : DEFAULT_WATCHDOG_SETTINGS.morningSummaryRoles;
  return {
    startDate: row.startDate,
    checkoutGraceMinutes: row.checkoutGraceMinutes,
    completedInvoiceGraceHours: row.completedInvoiceGraceHours,
    invoiceSendGraceHours: row.invoiceSendGraceHours,
    accountingSyncGraceHours: row.accountingSyncGraceHours,
    morningSummaryEnabled: row.morningSummaryEnabled,
    morningSummaryRoles: roles,
  };
}

export async function saveBillingWatchdogSettings(
  prisma: PrismaClient,
  companyId: string,
  input: Partial<BillingWatchdogSettingsView>
) {
  const current = await getBillingWatchdogSettings(prisma, companyId);
  const data = {
    startDate: input.startDate ?? current.startDate,
    checkoutGraceMinutes: input.checkoutGraceMinutes ?? current.checkoutGraceMinutes,
    completedInvoiceGraceHours: input.completedInvoiceGraceHours ?? current.completedInvoiceGraceHours,
    invoiceSendGraceHours: input.invoiceSendGraceHours ?? current.invoiceSendGraceHours,
    accountingSyncGraceHours: input.accountingSyncGraceHours ?? current.accountingSyncGraceHours,
    morningSummaryEnabled: input.morningSummaryEnabled ?? current.morningSummaryEnabled,
    morningSummaryRoles: input.morningSummaryRoles ?? current.morningSummaryRoles,
  };
  return prisma.billingWatchdogSettings.upsert({
    where: { companyId },
    create: { companyId, ...data },
    update: data,
  });
}
