import Stripe from "stripe";
import { stripeSecretKey } from "@/lib/payments/config";

let cached: Stripe | null = null;

export function getStripe(): Stripe | null {
  const key = stripeSecretKey();
  if (!key) return null;
  if (!cached) {
    cached = new Stripe(key, {
      typescript: true,
      appInfo: { name: "ContractorYou", version: "0.1.0" },
    });
  }
  return cached;
}

export function requireStripe() {
  const stripe = getStripe();
  if (!stripe) {
    throw new Error("Stripe is not configured. Set STRIPE_SECRET_KEY on the server.");
  }
  return stripe;
}

export { Stripe };
