export function quickbooksWebhookConfigured() {
  return Boolean(process.env.INTUIT_WEBHOOK_VERIFIER_TOKEN?.trim());
}
