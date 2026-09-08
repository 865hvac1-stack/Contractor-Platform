"use client";

import { ActionForm } from "@/components/action-form";
import { Button } from "@/components/ui/button";
import { saveCustomerConversationOwnerAction } from "@/server/actions/highlevel";
import type { CustomerConversationOwner } from "@/lib/comms/conversation-owner";
import { conversationOwnerCopy } from "@/lib/comms/conversation-owner";

const OPTIONS: Array<{ value: CustomerConversationOwner; label: string; hint: string }> = [
  {
    value: "HIGHLEVEL_AI",
    label: "HighLevel AI (Regina)",
    hint: "HighLevel handles natural customer conversations. ContractorYou remains the source of truth for scheduling and business data.",
  },
  {
    value: "CONTRACTORYOU",
    label: "ContractorYou",
    hint: "ContractorYou may reply to inbound scheduling texts. Turn HighLevel Conversation AI off for this location if you use this.",
  },
  {
    value: "MANUAL",
    label: "Manual only",
    hint: "Neither AI replies automatically. The office sends customer texts from ContractorYou.",
  },
];

export function ConversationOwnerForm({ value }: { value: CustomerConversationOwner }) {
  return (
    <section className="rounded-2xl border border-[var(--border)] bg-white p-5 space-y-3">
      <h2 className="font-medium">AI customer responder</h2>
      <p className="text-sm text-[var(--muted-foreground)]">{conversationOwnerCopy(value)}</p>
      <ActionForm action={saveCustomerConversationOwnerAction} className="space-y-3">
        <fieldset className="space-y-2">
          <legend className="sr-only">Customer conversation owner</legend>
          {OPTIONS.map((option) => (
            <label
              key={option.value}
              className="flex cursor-pointer items-start gap-3 rounded-xl border border-[var(--border)] px-3 py-2.5 has-[:checked]:border-[var(--cy-orange)]/50 has-[:checked]:bg-orange-50/40"
            >
              <input
                type="radio"
                name="customerConversationOwner"
                value={option.value}
                defaultChecked={value === option.value}
                className="mt-1"
              />
              <span>
                <span className="block text-sm font-medium">{option.label}</span>
                <span className="mt-0.5 block text-xs text-[var(--muted-foreground)]">{option.hint}</span>
              </span>
            </label>
          ))}
        </fieldset>
        <Button type="submit">Save conversation owner</Button>
      </ActionForm>
    </section>
  );
}
