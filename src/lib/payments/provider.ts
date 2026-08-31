export type PaymentProviderName = "stripe" | "manual";

export {
  stripeConfigured,
  stripePublishableKey,
  stripeWebhookSecret,
  missingStripeEnvVars,
} from "@/lib/payments/config";

import { stripeConfigured } from "@/lib/payments/config";

export function activePaymentProvider(): PaymentProviderName {
  return stripeConfigured() ? "stripe" : "manual";
}

export function paymentLabel(input: { provider: string; status: string; method: string }) {
  if (input.provider === "STRIPE" && (input.status === "CONFIRMED" || input.status === "SUCCEEDED")) {
    return input.method === "ACH" ? "Bank payment confirmed" : "Card payment confirmed";
  }
  if (input.provider === "STRIPE" && input.status === "PROCESSING") return "Bank/card payment processing";
  if (input.provider === "STRIPE" && input.status === "FAILED") return "Electronic payment failed";
  if (input.provider === "STRIPE" && input.status === "DISPUTED") return "Payment disputed";
  if (input.provider === "STRIPE" && (input.status === "REFUNDED" || input.status === "PARTIALLY_REFUNDED")) {
    return input.status === "REFUNDED" ? "Refunded" : "Partially refunded";
  }
  if (input.provider === "MANUAL") return `Recorded payment · ${input.method.replaceAll("_", " ")}`;
  return input.status;
}
