export function conversationCanAutoBook(
  policy: { autoBookingEnabled: boolean },
  rule?: { autoBookAllowed: boolean; requiresOfficeApproval: boolean } | null
) {
  return Boolean(policy.autoBookingEnabled && (!rule || (rule.autoBookAllowed && !rule.requiresOfficeApproval)));
}
