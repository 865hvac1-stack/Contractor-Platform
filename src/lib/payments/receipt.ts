import { emailConfigured, sendTransactionalEmail } from "@/lib/email/resend";
import { formatMoney } from "@/lib/money";

export async function sendPaymentReceiptEmail(input: {
  to: string | null | undefined;
  contractorName: string;
  customerName: string;
  invoiceNumber: string;
  amountCents: number;
  methodLabel: string;
  reference: string;
  paidAt: Date;
  companyId?: string | null;
}) {
  if (!input.to || !emailConfigured()) {
    return { sent: false as const, reason: emailConfigured() ? "no_customer_email" : "email_not_configured" };
  }
  const amount = formatMoney(input.amountCents);
  const when = input.paidAt.toLocaleString("en-US");
  const text = [
    `Payment received by ${input.contractorName}`,
    `Invoice ${input.invoiceNumber}`,
    `Customer ${input.customerName}`,
    `Amount ${amount}`,
    `Method ${input.methodLabel}`,
    `Reference ${input.reference}`,
    `Date ${when}`,
    "This receipt does not include full card or bank numbers.",
  ].join("\n");
  const html = `<p>Payment received by <strong>${escapeHtml(input.contractorName)}</strong></p>
<p>Invoice ${escapeHtml(input.invoiceNumber)} · ${escapeHtml(input.customerName)}</p>
<p>Amount <strong>${escapeHtml(amount)}</strong></p>
<p>${escapeHtml(input.methodLabel)} · Ref ${escapeHtml(input.reference)}</p>
<p>${escapeHtml(when)}</p>
<p>Powered by ContractorYou. Card and bank details are handled by Stripe.</p>`;
  const result = await sendTransactionalEmail({
    to: input.to,
    subject: `Receipt from ${input.contractorName} · Invoice ${input.invoiceNumber}`,
    html,
    text,
    companyId: input.companyId,
  });
  return result.ok
    ? { sent: true as const }
    : { sent: false as const, reason: result.error };
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
