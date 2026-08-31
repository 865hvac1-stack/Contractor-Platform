import { Prisma } from "@prisma/client";
import type { PrismaClient } from "@prisma/client";
import { upsertConnection } from "@/lib/integrations/store";
import { appUrl, STRIPE_CONNECT_PROVIDER_KEY } from "@/lib/payments/config";
import {
  CONNECT_ACCOUNT_INCLUDES,
  accountSessionOnboardingParams,
  connectIdempotencyKey,
  mapV2AccountCapabilities,
  publicPaymentsError,
  v2AccountCreateParams,
  v2AccountUpdateLinkParams,
  type V2AccountLike,
} from "@/lib/payments/connect-v2";
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
  closed?: boolean;
}): Exclude<ConnectUxStatus, "NOT_CONFIGURED" | "NOT_CONNECTED"> {
  if (input.disabledAt || input.closed) return "DISABLED";
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

async function retrieveV2Account(stripeAccountId: string) {
  const stripe = requireStripe();
  return stripe.v2.core.accounts.retrieve(stripeAccountId, {
    include: [...CONNECT_ACCOUNT_INCLUDES],
  }) as Promise<V2AccountLike>;
}

export async function refreshConnectAccount(prisma: PrismaClient, companyId: string) {
  const row = await getConnectAccount(prisma, companyId);
  if (!row) return null;
  const account = await retrieveV2Account(row.stripeAccountId);
  const mapped = mapV2AccountCapabilities(account);
  const onboardingStatus = deriveOnboardingStatus({
    disabledAt: row.disabledAt,
    chargesEnabled: mapped.chargesEnabled,
    payoutsEnabled: mapped.payoutsEnabled,
    detailsSubmitted: mapped.detailsSubmitted,
    requirementsDue: mapped.requirementsDue,
    closed: mapped.closed,
  });
  const previous = row.onboardingStatus;
  const updated = await prisma.stripeConnectAccount.update({
    where: { id: row.id },
    data: {
      chargesEnabled: mapped.chargesEnabled,
      payoutsEnabled: mapped.payoutsEnabled,
      detailsSubmitted: mapped.detailsSubmitted,
      requirementsDue: mapped.requirementsDue,
      onboardingStatus: row.disabledAt || mapped.closed ? "DISABLED" : onboardingStatus,
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
  if (previous !== updated.onboardingStatus) {
    const { writeAudit } = await import("@/lib/audit");
    await writeAudit({
      companyId,
      action:
        updated.onboardingStatus === "CONNECTED"
          ? "payments.account_active"
          : updated.onboardingStatus === "RESTRICTED" || updated.onboardingStatus === "ACTION_REQUIRED"
            ? "payments.account_restricted"
            : "payments.account_status_changed",
      entityType: "StripeConnectAccount",
      entityId: updated.stripeAccountId,
      metadata: { status: updated.onboardingStatus },
    });
  }
  return updated;
}

async function persistCreatedAccount(
  prisma: PrismaClient,
  input: { companyId: string; stripeAccountId: string }
) {
  try {
    const created = await prisma.stripeConnectAccount.create({
      data: {
        companyId: input.companyId,
        stripeAccountId: input.stripeAccountId,
        onboardingStatus: "ONBOARDING",
      },
    });
    await upsertConnection({
      companyId: input.companyId,
      providerKey: STRIPE_CONNECT_PROVIDER_KEY,
      status: "CONNECTING",
      externalAccountId: input.stripeAccountId,
      accountLabel: "ContractorYou Payments",
    });
    return { row: created, created: true as const };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const existing = await getConnectAccount(prisma, input.companyId);
      if (existing) return { row: existing, created: false as const };
    }
    throw error;
  }
}

export async function createOrResumeConnectAccount(
  prisma: PrismaClient,
  input: { companyId: string; email?: string | null; businessName: string }
) {
  const existing = await getConnectAccount(prisma, input.companyId);
  const stripe = requireStripe();
  let stripeAccountId = existing?.stripeAccountId;
  let created = false;
  if (!stripeAccountId) {
    const account = await stripe.v2.core.accounts.create(v2AccountCreateParams(input), {
      idempotencyKey: connectIdempotencyKey(input.companyId),
    });
    stripeAccountId = account.id;
    const persisted = await persistCreatedAccount(prisma, {
      companyId: input.companyId,
      stripeAccountId,
    });
    created = persisted.created;
    stripeAccountId = persisted.row.stripeAccountId;
  } else if (existing?.disabledAt) {
    await prisma.stripeConnectAccount.update({
      where: { id: existing.id },
      data: { disabledAt: null, onboardingStatus: "ONBOARDING" },
    });
  }
  return { stripeAccountId, created };
}

export async function createOnboardingAccountSession(stripeAccountId: string) {
  const stripe = requireStripe();
  return stripe.accountSessions.create(accountSessionOnboardingParams(stripeAccountId));
}

/** Create or resume the tenant's connected account, then issue an Account Session for that same account. */
export async function issueOnboardingAccountSession(
  prisma: PrismaClient,
  input: { companyId: string; email?: string | null; businessName: string }
) {
  const started = await createOrResumeConnectAccount(prisma, input);
  const session = await createOnboardingAccountSession(started.stripeAccountId);
  return {
    stripeAccountId: started.stripeAccountId,
    created: started.created,
    clientSecret: session.client_secret ?? null,
  };
}

export async function createAccountUpdateLink(stripeAccountId: string) {
  const stripe = requireStripe();
  return stripe.v2.core.accountLinks.create(
    v2AccountUpdateLinkParams(stripeAccountId, {
      refreshUrl: `${appUrl()}/settings/payments`,
      returnUrl: `${appUrl()}/settings/payments?returned=1`,
    })
  );
}

export async function createAccountLoginLink(stripeAccountId: string) {
  try {
    const stripe = requireStripe();
    return await stripe.accounts.createLoginLink(stripeAccountId);
  } catch {
    const update = await createAccountUpdateLink(stripeAccountId);
    return { url: update.url };
  }
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

export { publicPaymentsError };
