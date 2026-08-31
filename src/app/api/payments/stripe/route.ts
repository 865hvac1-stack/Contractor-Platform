import { POST as stripeWebhook } from "@/app/api/webhooks/stripe/route";

/** Legacy Checkout webhook path. Same handler as /api/webhooks/stripe. */
export async function POST(request: Request) {
  return stripeWebhook(request);
}
