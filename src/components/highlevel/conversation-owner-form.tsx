"use client";

import { ActionForm } from "@/components/action-form";
import { Button } from "@/components/ui/button";
import { saveCustomerConversationOwnerAction } from "@/server/actions/highlevel";
import type { CustomerConversationOwner } from "@/lib/comms/conversation-owner";
import { conversationOwnerCopy } from "@/lib/comms/conversation-owner";

const OPTIONS: Array<{ value: CustomerConversationOwner; label: string; hint: string }> = [
  {
    value: "CONTRACTORYOU",
    label: "ContractorYou AI receptionist",
    hint: "ContractorYou Regina replies through HighLevel SMS. Turn HighLevel Conversation AI off so customers are not double-texted.",
  },
  {
    value: "HIGHLEVEL_AI",
    label: "HighLevel Conversation AI",
    hint: "HighLevel talks to the customer. ContractorYou remains the source of truth for scheduling. Use only if Regina is running in HighLevel.",
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
