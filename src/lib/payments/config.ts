export const STRIPE_PROVIDER = "STRIPE";
export const STRIPE_CONNECT_PROVIDER_KEY = "stripe_connect";

export function stripeSecretKey() {
  return process.env.STRIPE_SECRET_KEY?.trim() || "";
}

export function stripePublishableKey() {
  return (
    process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY?.trim() ||
    process.env.STRIPE_PUBLISHABLE_KEY?.trim() ||
    ""
  );
}

export function stripeWebhookSecret() {
  return process.env.STRIPE_WEBHOOK_SECRET?.trim() || "";
}

export function stripeConnectClientId() {
  return process.env.STRIPE_CONNECT_CLIENT_ID?.trim() || "";
}

export function stripeConfigured() {
  return Boolean(stripeSecretKey());
}

export function stripeClientConfigured() {
  return stripeConfigured() && Boolean(stripePublishableKey());
}

export function stripeWebhookConfigured() {
  return Boolean(stripeWebhookSecret());
}

export function missingStripeEnvVars() {
  const missing: string[] = [];
  if (!stripeSecretKey()) missing.push("STRIPE_SECRET_KEY");
  if (!stripePublishableKey()) missing.push("NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY");
  if (!stripeWebhookSecret()) missing.push("STRIPE_WEBHOOK_SECRET");
  return missing;
}

/** Basis points taken by the platform. Default 0 — never invent a fee. */
export function platformFeeBps() {
  const raw = Number(process.env.STRIPE_PLATFORM_FEE_BPS || "0");
  if (!Number.isFinite(raw) || raw <= 0) return 0;
  return Math.min(10_000, Math.round(raw));
}

export function appUrl() {
  return process.env.APP_URL?.replace(/\/$/, "") || "http://127.0.0.1:43123";
}

export function stripeModeLabel() {
  const key = stripeSecretKey();
  if (!key) return "not configured";
  if (key.startsWith("sk_test_") || key.startsWith("rk_test_")) return "test";
  if (key.startsWith("sk_live_") || key.startsWith("rk_live_")) return "live";
  return "unknown";
}
