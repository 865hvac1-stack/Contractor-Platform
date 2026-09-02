"use client";

import { ActionForm } from "@/components/action-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { sendInboxSmsAction } from "@/server/actions/highlevel";

export function CompanySmsForm({
  to,
  customerId,
  leadId,
  placeholder = "Text the customer from the company number…",
  requireLiveConfirm = false,
}: {
  to: string;
  customerId?: string | null;
  leadId?: string | null;
  placeholder?: string;
  requireLiveConfirm?: boolean;
}) {
  return (
    <ActionForm action={sendInboxSmsAction} className="mt-3 flex flex-col gap-2 sm:flex-row" successMessage="Sent.">
      <input type="hidden" name="to" value={to} />
      {customerId ? <input type="hidden" name="customerId" value={customerId} /> : null}
      {leadId ? <input type="hidden" name="leadId" value={leadId} /> : null}
      {requireLiveConfirm ? (
        <Input name="confirmExternalSend" placeholder="Type SEND for live HighLevel SMS" className="h-10 sm:max-w-[14rem]" />
      ) : null}
      <Input name="body" placeholder={placeholder} required className="h-10" />
      <Button type="submit" size="sm">
        Send company text
      </Button>
    </ActionForm>
  );
}
