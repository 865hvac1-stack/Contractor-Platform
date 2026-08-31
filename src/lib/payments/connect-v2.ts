import type Stripe from "stripe";

export const CONNECT_ACCOUNT_INCLUDES = [
  "configuration.merchant",
  "identity",
  "requirements",
  "defaults",
] as const;

export type V2AccountLike = {
  id: string;
  closed?: boolean;
  applied_configurations?: Array<string>;
  configuration?: {
    merchant?: {
      applied?: boolean;
      capabilities?: {
        card_payments?: { status?: string };
        ach_debit_payments?: { status?: string };
        stripe_balance?: { payouts?: { status?: string } };
      };
    };
  };
  requirements?: {
    entries?: Array<{
      awaiting_action_from?: string | null;
      description?: string | null;
    }>;
  };
  identity?: {
    business_details?: { registered_name?: string | null };
  };
};

export function v2AccountCreateParams(input: {
  companyId: string;
  email?: string | null;
  businessName: string;
}) {
  return {
    contact_email: input.email || undefined,
    display_name: input.businessName,
    dashboard: "express" as const,
    identity: {
      country: "us" as const,
      entity_type: "company" as const,
      business_details: { registered_name: input.businessName },
    },
    configuration: {
      merchant: {
        capabilities: {
          card_payments: { requested: true },
          ach_debit_payments: { requested: true },
        },
      },
    },
    defaults: {
      currency: "usd",
      locales: ["en-US" as const],
      responsibilities: {
        fees_collector: "stripe" as const,
        losses_collector: "stripe" as const,
      },
    },
    metadata: { companyId: input.companyId },
    include: [...CONNECT_ACCOUNT_INCLUDES],
  };
}

export function v2OnboardingLinkParams(stripeAccountId: string, input: { refreshUrl: string; returnUrl: string }) {
  return {
    account: stripeAccountId,
    use_case: {
      type: "account_onboarding" as const,
      account_onboarding: {
        configurations: ["merchant" as const],
        collection_options: { fields: "eventually_due" as const },
        refresh_url: input.refreshUrl,
        return_url: input.returnUrl,
      },
    },
  };
}

export function v2AccountUpdateLinkParams(stripeAccountId: string, input: { refreshUrl: string; returnUrl: string }) {
  return {
    account: stripeAccountId,
    use_case: {
      type: "account_update" as const,
      account_update: {
        configurations: ["merchant" as const],
        collection_options: { fields: "currently_due" as const },
        refresh_url: input.refreshUrl,
        return_url: input.returnUrl,
      },
    },
  };
}

export function mapV2AccountCapabilities(account: V2AccountLike) {
  const merchant = account.configuration?.merchant;
  const cardStatus = merchant?.capabilities?.card_payments?.status ?? "";
  const payoutStatus = merchant?.capabilities?.stripe_balance?.payouts?.status ?? "";
  const userDue = (account.requirements?.entries ?? []).filter((entry) => entry.awaiting_action_from === "user");
  const chargesEnabled = cardStatus === "active";
  const payoutsEnabled = payoutStatus === "active";
  const detailsSubmitted = Boolean(merchant?.applied) && userDue.length === 0;
  return {
    chargesEnabled,
    payoutsEnabled,
    detailsSubmitted,
    requirementsDue: userDue
      .map((entry) => entry.description)
      .filter((value): value is string => Boolean(value))
      .join(",") || (userDue.length ? "additional_information" : null),
    closed: Boolean(account.closed),
    merchantApplied: Boolean(merchant?.applied),
  };
}

export function connectAccountIdFromEvent(event: {
  type?: string;
  account?: unknown;
  related_object?: { id?: string } | null;
  data?: unknown;
}) {
  if (typeof event.account === "string" && event.account.startsWith("acct_")) return event.account;
  const related = event.related_object?.id;
  if (typeof related === "string" && related.startsWith("acct_")) return related;
  const object = (event.data as { object?: { id?: string; object?: string } } | undefined)?.object;
  if (
    object?.id?.startsWith("acct_") &&
    (object.object === "account" || object.object === "v2.core.account")
  ) {
    return object.id;
  }
  return undefined;
}

export function isV2AccountEvent(type: string) {
  return (
    type === "account.updated" ||
    type.startsWith("v2.core.account") ||
    type === "v2.core.account_link.returned"
  );
}

export function publicPaymentsError(error: unknown) {
  const raw = error instanceof Error ? error.message : "Unknown payment-provider error.";
  const diagnostic = raw
    .replace(/sk_(live|test)_[A-Za-z0-9]+/g, "[redacted]")
    .replace(/whsec_[A-Za-z0-9]+/g, "[redacted]")
    .slice(0, 180);
  return {
    user: "ContractorYou Payments couldn't start setup. Please try again or contact your administrator.",
    diagnostic,
  };
}

export function connectIdempotencyKey(companyId: string) {
  return `cy-connect-v2-${companyId}`;
}

export type { Stripe };
