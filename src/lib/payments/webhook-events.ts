/** Authoritative Stripe events for ContractorYou Payments. */
export const STRIPE_PAYMENT_WEBHOOK_EVENTS = [
  "payment_intent.succeeded",
  "payment_intent.processing",
  "payment_intent.payment_failed",
  "payment_intent.canceled",
  "charge.succeeded",
  "charge.refunded",
  "refund.updated",
  "charge.dispute.created",
  "checkout.session.completed",
] as const;

export const STRIPE_CONNECT_ACCOUNT_WEBHOOK_EVENTS = [
  "account.updated",
  "v2.core.account.updated",
  "v2.core.account.created",
  "v2.core.account[requirements].updated",
  "v2.core.account[configuration.merchant].updated",
  "v2.core.account[configuration.merchant].capability_status_updated",
  "v2.core.account[future_requirements].updated",
  "v2.core.account_link.returned",
  "v2.core.account.closed",
] as const;

/**
 * Direct charges (`stripeAccount` on PaymentIntents) emit payment events on the
 * connected account. The Stripe Dashboard endpoint must listen to
 * “Events on Connected accounts” (current Stripe Connect wording).
 * Platform-only events will not update ContractorYou invoices.
 */
export const STRIPE_WEBHOOK_LISTEN_MODE = "events_on_connected_accounts";

export const STRIPE_WEBHOOK_PATH = "/api/webhooks/stripe";
export const STRIPE_WEBHOOK_LEGACY_PATH = "/api/payments/stripe";
export const STRIPE_WEBHOOK_SECRET_ENV = "STRIPE_WEBHOOK_SECRET";
