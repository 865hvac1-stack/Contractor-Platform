"use client";

import { ActionForm } from "@/components/action-form";
import { Button } from "@/components/ui/button";
import { saveAiReceptionistSettingsAction } from "@/server/actions/receptionist";

export function ReceptionistSettingsForm({
  settings,
}: {
  settings: {
    enabled: boolean;
    assistantName: string;
    autoReplyInboundSms: boolean;
    autoBookServiceCalls: boolean;
    allowSameDayBooking: boolean;
    humanHandoffFallback: boolean;
    businessHoursBehavior: string;
  };
}) {
  return (
    <section className="rounded-2xl border border-[var(--border)] bg-white p-5 space-y-4">
      <div>
        <h2 className="font-medium">AI receptionist</h2>
        <p className="mt-1 text-sm text-[var(--muted-foreground)]">
          ContractorYou reads the inbound text, uses real availability and booking, then replies through HighLevel
          SMS. Turn HighLevel Conversation AI off so the customer gets one reply.
        </p>
      </div>
      <ActionForm action={saveAiReceptionistSettingsAction} className="space-y-3">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="enabled" defaultChecked={settings.enabled} />
          AI receptionist enabled
        </label>
        <label className="block text-sm">
          <span className="mb-1 block text-[var(--muted-foreground)]">Assistant name</span>
          <input
            name="assistantName"
            defaultValue={settings.assistantName}
            className="w-full rounded-xl border border-[var(--border)] px-3 py-2"
          />
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="autoReplyInboundSms" defaultChecked={settings.autoReplyInboundSms} />
          Auto-reply to inbound SMS
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="autoBookServiceCalls" defaultChecked={settings.autoBookServiceCalls} />
          Auto-book service calls when a window is chosen
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="allowSameDayBooking" defaultChecked={settings.allowSameDayBooking} />
          Allow same-day booking when company scheduling rules allow it
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="humanHandoffFallback" defaultChecked={settings.humanHandoffFallback} />
          Hand off to the office when unsure
        </label>
        <label className="block text-sm">
          <span className="mb-1 block text-[var(--muted-foreground)]">After-hours behavior</span>
          <select
            name="businessHoursBehavior"
            defaultValue={settings.businessHoursBehavior}
            className="w-full rounded-xl border border-[var(--border)] px-3 py-2"
          >
            <option value="ALWAYS">Reply any time</option>
            <option value="BUSINESS_HOURS_ONLY">Reply only during business hours</option>
            <option value="AFTER_HOURS_HANDOFF">After hours, flag the office</option>
          </select>
        </label>
        <Button type="submit">Save receptionist</Button>
      </ActionForm>
    </section>
  );
}
