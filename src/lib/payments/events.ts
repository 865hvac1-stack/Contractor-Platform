/** Payment events companies may attach to existing Automations. None are enabled by default. */
export const PAYMENT_AUTOMATION_TRIGGERS = [
  "PAYMENT_SUCCEEDED",
  "PAYMENT_FAILED",
  "INVOICE_PAID",
  "PARTIAL_PAYMENT",
  "REFUND_COMPLETED",
] as const;

export type PaymentAutomationTrigger = (typeof PAYMENT_AUTOMATION_TRIGGERS)[number];

export async function emitPaymentAutomationEvent(
  prisma: {
    automation: {
      findMany: (args: {
        where: { companyId: string; enabled: boolean; trigger: string };
        select: { id: true; name: true; action: true };
      }) => Promise<{ id: string; name: string; action: string }[]>;
    };
  },
  input: { companyId: string; trigger: PaymentAutomationTrigger }
) {
  return prisma.automation.findMany({
    where: { companyId: input.companyId, enabled: true, trigger: input.trigger },
    select: { id: true, name: true, action: true },
  });
}
