export type PaymentProviderName = "stripe" | "manual";

export function stripeConfigured() {
  return Boolean(process.env.STRIPE_SECRET_KEY?.trim());
}

export function stripePublishableKey() {
  return process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY?.trim() || "";
}

export function activePaymentProvider(): PaymentProviderName {
  return stripeConfigured() ? "stripe" : "manual";
}

export function paymentLabel(input: { provider: string; status: string; method: string }) {
  if (input.provider === "STRIPE" && input.status === "CONFIRMED") return "Card payment confirmed";
  if (input.provider === "MANUAL") return `Recorded payment · ${input.method.replaceAll("_", " ")}`;
  return input.status;
}
