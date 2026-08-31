import type { PrismaClient } from "@prisma/client";
import { upsertConnection } from "@/lib/integrations/store";
import { appUrl, STRIPE_CONNECT_PROVIDER_KEY } from "@/lib/payments/config";
import { requireStripe } from "@/lib/payments/stripe-client";

export type ConnectUxStatus =
  | "NOT_CONFIGURED"
  | "NOT_CONNECTED"
  | "ONBOARDING"
  | "ACTION_REQUIRED"
  | "CONNECTED"
  | "RESTRICTED"
  | "DISABLED";

export function deriveOnboardingStatus(input: {
  disabledAt?: Date | null;
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  detailsSubmitted: boolean;
  requirementsDue?: string | null;
}): Exclude<ConnectUxStatus, "NOT_CONFIGURED" | "NOT_CONNECTED"> {
  if (input.disabledAt) return "DISABLED";
  if (input.chargesEnabled && input.payoutsEnabled && input.detailsSubmitted) return "CONNECTED";
  if (input.detailsSubmitted && (!input.chargesEnabled || !input.payoutsEnabled || input.requirementsDue)) {
    return "ACTION_REQUIRED";
  }
  if (!input.chargesEnabled && input.detailsSubmitted) return "RESTRICTED";
  return "ONBOARDING";
}

export async function getConnectAccount(prisma: PrismaClient, companyId: string) {
  return prisma.stripeConnectAccount.findUnique({ where: { companyId } });
}

export async function refreshConnectAccount(prisma: PrismaClient, companyId: string) {
  const row = await getConnectAccount(prisma, companyId);
  if (!row) return null;
  const stripe = requireStripe();
  const account = await stripe.accounts.retrieve(row.stripeAccountId);
  const due = [
    ...(account.requirements?.currently_due ?? []),
    ...(account.requirements?.past_due ?? []),
  ];
  const bank = account.external_accounts?.data?.find((item) => item.object === "bank_account") as
    | { last4?: string; bank_name?: string }
    | undefined;
  const schedule = account.settings?.payouts?.schedule;
  const payoutSchedule = schedule?.interval
    ? schedule.interval === "daily"
      ? "Daily"
      : schedule.interval === "weekly"
        ? `Weekly${schedule.weekly_anchor ? ` (${schedule.weekly_anchor})` : ""}`
        : schedule.interval === "monthly"
          ? "Monthly"
          : schedule.interval
    : null;
  const onboardingStatus = deriveOnboardingStatus({
    disabledAt: row.disabledAt,
    chargesEnabled: Boolean(account.charges_enabled),
    payoutsEnabled: Boolean(account.payouts_enabled),
    detailsSubmitted: Boolean(account.details_submitted),
    requirementsDue: due.length ? due.join(",") : null,
  });
  const updated = await prisma.stripeConnectAccount.update({
    where: { id: row.id },
    data: {
      chargesEnabled: Boolean(account.charges_enabled),
      payoutsEnabled: Boolean(account.payouts_enabled),
      detailsSubmitted: Boolean(account.details_submitted),
      requirementsDue: due.length ? due.join(",") : null,
      payoutSchedule,
      bankLast4: bank?.last4 ?? row.bankLast4,
      bankName: bank?.bank_name ?? row.bankName,
      onboardingStatus: row.disabledAt ? "DISABLED" : onboardingStatus,
    },
  });
  await upsertConnection({
    companyId,
    providerKey: STRIPE_CONNECT_PROVIDER_KEY,
    status: updated.onboardingStatus === "CONNECTED" ? "CONNECTED" : "CONNECTING",
    externalAccountId: updated.stripeAccountId,
    accountLabel: "ContractorYou Payments",
    healthMessage: updated.onboardingStatus,
  });
  return updated;
}

export async function createOrResumeConnectAccount(
  prisma: PrismaClient,
  input: { companyId: string; email?: string | null; businessName: string }
) {
  const existing = await getConnectAccount(prisma, input.companyId);
  const stripe = requireStripe();
  let stripeAccountId = existing?.stripeAccountId;
  if (!stripeAccountId) {
    const account = await stripe.accounts.create({
      type: "express",
      country: "US",
      email: input.email || undefined,
      business_profile: { name: input.businessName },
      capabilities: {
        card_payments: { requested: true },
        transfers: { requested: true },
        us_bank_account_ach_payments: { requested: true },
      },
      metadata: { companyId: input.companyId },
    });
    stripeAccountId = account.id;
    await prisma.stripeConnectAccount.create({
      data: {
        companyId: input.companyId,
        stripeAccountId,
        onboardingStatus: "ONBOARDING",
      },
    });
    await upsertConnection({
      companyId: input.companyId,
      providerKey: STRIPE_CONNECT_PROVIDER_KEY,
      status: "CONNECTING",
      externalAccountId: stripeAccountId,
      accountLabel: "ContractorYou Payments",
    });
  }
  const link = await stripe.accountLinks.create({
    account: stripeAccountId,
    refresh_url: `${appUrl()}/api/payments/connect/refresh`,
    return_url: `${appUrl()}/settings/payments?returned=1`,
    type: "account_onboarding",
  });
  return { url: link.url, stripeAccountId };
}

export async function createAccountUpdateLink(stripeAccountId: string) {
  const stripe = requireStripe();
  return stripe.accountLinks.create({
    account: stripeAccountId,
    refresh_url: `${appUrl()}/settings/payments`,
    return_url: `${appUrl()}/settings/payments?returned=1`,
    type: "account_onboarding",
  });
}

export async function createAccountLoginLink(stripeAccountId: string) {
  const stripe = requireStripe();
  return stripe.accounts.createLoginLink(stripeAccountId);
}

export function uxStatus(input: {
  platformConfigured: boolean;
  account: {
    disabledAt: Date | null;
    onboardingStatus: string;
    chargesEnabled: boolean;
    payoutsEnabled: boolean;
    detailsSubmitted: boolean;
    requirementsDue: string | null;
  } | null;
}): ConnectUxStatus {
  if (!input.platformConfigured) return "NOT_CONFIGURED";
  if (!input.account) return "NOT_CONNECTED";
  if (input.account.disabledAt) return "DISABLED";
  return deriveOnboardingStatus(input.account);
}
