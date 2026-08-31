import type Stripe from "stripe";

export const CONNECT_ACCOUNT_INCLUDES = [
  "configuration.merchant",
  "identity",
  "requirements",
  "defaults",
] as const;

type CapabilityStatusDetail = { code?: string; resolution?: string };

type CapabilityLike = {
  status?: string;
  status_details?: CapabilityStatusDetail[];
};

export type V2AccountLike = {
  id: string;
  closed?: boolean;
  applied_configurations?: Array<string>;
  configuration?: {
    merchant?: {
      /** Merchant config is on — not the same as onboarding complete. May be a boolean or a timestamp. */
      applied?: boolean | string | null;
      capabilities?: {
        card_payments?: CapabilityLike;
        ach_debit_payments?: CapabilityLike;
        stripe_balance?: { payouts?: CapabilityLike };
      };
    };
  };
  requirements?: {
    entries?: Array<{
      awaiting_action_from?: string | null;
      description?: string | null;
      minimum_deadline?: { status?: string | null } | null;
    }>;
    summary?: { minimum_deadline?: { status?: string | null } | null };
  };
  identity?: {
    business_details?: { registered_name?: string | null };
  };
};

function capabilityNeedsUser(capability?: CapabilityLike | null) {
  return (capability?.status_details ?? []).some((detail) => detail.resolution === "provide_info");
}

function merchantConfigApplied(applied: unknown) {
  return applied === true || (typeof applied === "string" && applied.length > 0);
}

function safeCapabilityLabel(name: string, capability?: CapabilityLike | null) {
  const status = capability?.status || "not_requested";
  const codes = (capability?.status_details ?? [])
    .map((detail) => detail.code)
    .filter((value): value is string => Boolean(value));
  return [name, status, ...codes].join(":");
}

/**
 * SaaS / direct-charge merchant (Stripe current Accounts v2).
 *
 * Stripe rejects `dashboard: express` with `fees_collector`/`losses_collector: stripe`
 * (`account_controller_express_dash_without_application_losses_or_fees`).
 * Express requires application-owned fees AND losses (marketplace), which is not
 * ContractorYou's model.
 *
 * Documented SaaS combination:
 * https://docs.stripe.com/connect/saas/tasks/create
 * dashboard=full, fees_collector=stripe, losses_collector=stripe,
 * merchant.card_payments only.
 */
export function v2AccountCreateParams(input: {
  companyId: string;
  email?: string | null;
  businessName: string;
}) {
  return {
    contact_email: input.email || undefined,
    display_name: input.businessName,
    dashboard: "full" as const,
    identity: {
      country: "us" as const,
      entity_type: "company" as const,
      business_details: { registered_name: input.businessName },
    },
    configuration: {
      merchant: {
        capabilities: {
          card_payments: { requested: true },
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
  const card = merchant?.capabilities?.card_payments;
  const payouts = merchant?.capabilities?.stripe_balance?.payouts;
  const cardStatus = card?.status ?? "";
  const payoutStatus = payouts?.status ?? "";
  const userDue = (account.requirements?.entries ?? []).filter((entry) => entry.awaiting_action_from === "user");
  const deadline = account.requirements?.summary?.minimum_deadline?.status ?? "";
  const deadlineNeedsUser = deadline === "currently_due" || deadline === "past_due";
  const chargesEnabled = cardStatus === "active";
  const payoutsEnabled = payoutStatus === "active";
  const userActionRequired =
    merchantConfigApplied(merchant?.applied) &&
    (userDue.length > 0 ||
      capabilityNeedsUser(card) ||
      capabilityNeedsUser(payouts) ||
      (deadlineNeedsUser && userDue.length > 0));
  const detailsSubmitted = chargesEnabled && payoutsEnabled;
  const requirementsDue = [
    safeCapabilityLabel("card_payments", card),
    safeCapabilityLabel("payouts", payouts),
    ...userDue
      .map((entry) => entry.description)
      .filter((value): value is string => Boolean(value)),
  ]
    .filter(Boolean)
    .join(",") || null;
  return {
    chargesEnabled,
    payoutsEnabled,
    detailsSubmitted,
    userActionRequired,
    cardStatus: cardStatus || "not_requested",
    payoutStatus: payoutStatus || "not_requested",
    requirementsDue,
    closed: Boolean(account.closed),
    merchantApplied: merchantConfigApplied(merchant?.applied),
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
  const stripeLike = error as {
    message?: string;
    code?: string;
    type?: string;
    requestId?: string;
    raw?: { code?: string; message?: string; request_id?: string; type?: string };
  };
  const code = stripeLike?.code || stripeLike?.raw?.code;
  const requestId = stripeLike?.requestId || stripeLike?.raw?.request_id;
  const raw = (stripeLike?.message || stripeLike?.raw?.message || "Unknown payment-provider error.")
    .replace(/sk_(live|test)_[A-Za-z0-9]+/g, "[redacted]")
    .replace(/whsec_[A-Za-z0-9]+/g, "[redacted]");
  const diagnostic = [code, requestId, raw].filter(Boolean).join(" · ").slice(0, 220);
  return {
    user: "ContractorYou Payments couldn't start setup. Please try again or contact your administrator.",
    diagnostic,
  };
}

/** New key after the unsupported Express+Stripe-liability create so Stripe does not replay that failure. */
export function connectIdempotencyKey(companyId: string) {
  return `cy-connect-v2-saas-${companyId}`;
}

/**
 * Settings → Payments can later enable these Account Session components
 * without leaving ContractorYou or creating a second payment system.
 * Only `account_onboarding` is enabled in this slice.
 */
export const FUTURE_EMBEDDED_COMPONENTS = [
  "account_management",
  "notification_banner",
  "payouts",
  "balances",
  "payments",
  "payment_details",
  "disputes_list",
] as const;

/**
 * Official Accounts v2 / SaaS Account Session for embedded Account Onboarding.
 * Do not set `external_account_collection: true` here: that forces Stripe user
 * authentication and sends contractors to connect.stripe.com. For
 * dashboard=full + Stripe-owned requirement collection, both that flag and
 * `disable_stripe_user_authentication` default to false. Bank and identity
 * fields still collect inside the embed as Stripe requirements.
 * https://docs.stripe.com/connect/saas/tasks/onboard
 * https://docs.stripe.com/connect/supported-embedded-components/account-onboarding
 */
export function accountSessionOnboardingParams(stripeAccountId: string) {
  return {
    account: stripeAccountId,
    components: {
      account_onboarding: {
        enabled: true,
      },
    },
  };
}

/** Browser-supplied company or Stripe ids are ignored. Session is always the authenticated tenant. */
export function tenantAccountForSession(input: {
  authenticatedCompanyId: string;
  storedStripeAccountId: string;
  requestedCompanyId?: unknown;
  requestedStripeAccountId?: unknown;
}) {
  void input.requestedCompanyId;
  void input.requestedStripeAccountId;
  return {
    companyId: input.authenticatedCompanyId,
    stripeAccountId: input.storedStripeAccountId,
  };
}

export type { Stripe };
