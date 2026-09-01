/** Actions the model may never request. These stay in normal ContractorYou UI. */
export const HIGH_RISK_ACTION_KEYS = [
  "invoice.refund",
  "payment.refund",
  "payment.void",
  "customer.delete",
  "job.delete",
  "invoice.delete",
  "estimate.delete",
  "payment.alter",
  "payroll.update",
  "compensation.change",
  "bank.credentials.update",
  "accounting.credentials.update",
  "integration.credentials.update",
  "company.ownership.change",
  "admin.invite",
  "user.invite_admin",
  "bulk.delete",
  "accounting.destructive_entry",
] as const;

export function isHighRiskActionKey(key: string) {
  return (HIGH_RISK_ACTION_KEYS as readonly string[]).includes(key);
}
