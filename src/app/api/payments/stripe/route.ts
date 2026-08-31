import { GET as stripeWebhookGet, POST as stripeWebhook } from "@/app/api/webhooks/stripe/route";

/** Legacy Checkout webhook path. Same handler as /api/webhooks/stripe. */
export async function GET() {
  return stripeWebhookGet();
}

export async function POST(request: Request) {
  return stripeWebhook(request);
}
