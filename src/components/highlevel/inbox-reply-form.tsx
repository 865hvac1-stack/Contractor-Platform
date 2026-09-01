"use client";

import { CompanySmsForm } from "@/components/highlevel/company-sms-form";

export function InboxReplyForm({
  to,
  customerId,
  leadId,
}: {
  to: string;
  customerId?: string | null;
  leadId?: string | null;
}) {
  return <CompanySmsForm to={to} customerId={customerId} leadId={leadId} placeholder="Reply by SMS…" />;
}
